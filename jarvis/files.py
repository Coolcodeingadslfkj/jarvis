"""File-system operations for the FILES menu. Deletes go to the Trash by default."""

import mimetypes
import os
import shutil
import stat
import subprocess
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

HOME = str(Path.home())
SEARCH_LIMIT = 300


def _norm(path):
    path = os.path.expanduser(path or HOME)
    return os.path.realpath(path)


def _kind(name, is_dir):
    if is_dir:
        return "folder"
    mt, _ = mimetypes.guess_type(name)
    ext = os.path.splitext(name)[1].lower()
    if mt:
        major = mt.split("/")[0]
        if major in ("image", "video", "audio"):
            return major
        if mt == "application/pdf":
            return "pdf"
        if mt in ("application/zip", "application/x-tar", "application/gzip", "application/x-7z-compressed",
                  "application/x-xz", "application/x-bzip2", "application/zstd", "application/vnd.rar"):
            return "archive"
    if ext in (".zst", ".xz", ".tgz", ".rar", ".7z", ".gz", ".bz2"):
        return "archive"
    if ext in (".py", ".js", ".ts", ".c", ".h", ".cpp", ".rs", ".go", ".java", ".sh", ".html", ".css",
               ".json", ".toml", ".yaml", ".yml", ".lua", ".rb", ".php", ".kt", ".cs", ".sql", ".xml"):
        return "code"
    if ext in (".txt", ".md", ".log", ".conf", ".cfg", ".ini", ".csv", ".rst"):
        return "text"
    if ext in (".doc", ".docx", ".odt", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp"):
        return "document"
    return "file"


def _entry(path, st=None):
    name = os.path.basename(path) or path
    try:
        st = st or os.stat(path)
        is_dir = stat.S_ISDIR(st.st_mode)
        size, mtime = st.st_size, st.st_mtime
    except OSError:
        is_dir, size, mtime = False, 0, 0
    return {"name": name, "path": path, "dir": is_dir, "size": size, "mtime": mtime,
            "kind": _kind(name, is_dir), "hidden": name.startswith("."),
            "link": os.path.islink(path)}


def list_dir(path, show_hidden=False):
    path = _norm(path)
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Not a directory: {path}")
    items = []
    with os.scandir(path) as it:
        for e in it:
            if not show_hidden and e.name.startswith("."):
                continue
            try:
                st = e.stat()
            except OSError:
                st = None
            items.append(_entry(e.path, st))
    items.sort(key=lambda x: (not x["dir"], x["name"].lower()))
    parent = os.path.dirname(path) if path != "/" else None
    return {"path": path, "parent": parent, "items": items,
            "writable": os.access(path, os.W_OK)}


def places():
    out = [{"name": "Home", "path": HOME, "icon": "home"}]
    for name, icon in (("Desktop", "desktop"), ("Documents", "document"), ("Downloads", "download"),
                       ("Pictures", "image"), ("Music", "audio"), ("Videos", "video")):
        p = os.path.join(HOME, name)
        if os.path.isdir(p):
            out.append({"name": name, "path": p, "icon": icon})
    out.append({"name": "Root /", "path": "/", "icon": "drive"})
    for base in ("/run/media/" + os.environ.get("USER", ""), "/media", "/mnt"):
        if os.path.isdir(base):
            try:
                for d in sorted(os.listdir(base)):
                    p = os.path.join(base, d)
                    if os.path.ismount(p):
                        out.append({"name": d, "path": p, "icon": "drive"})
            except OSError:
                pass
    trash = os.path.join(HOME, ".local/share/Trash/files")
    if os.path.isdir(trash):
        out.append({"name": "Trash", "path": trash, "icon": "trash"})
    return out


def open_path(path):
    path = _norm(path)
    subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)
    return path


def reveal(path):
    path = _norm(path)
    target = path if os.path.isdir(path) else os.path.dirname(path)
    cmd = ["dolphin", "--select", path] if shutil.which("dolphin") and not os.path.isdir(path) \
        else (["dolphin", target] if shutil.which("dolphin") else ["xdg-open", target])
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def terminal(path):
    path = _norm(path)
    if not os.path.isdir(path):
        path = os.path.dirname(path)
    for term in (["konsole", "--workdir", path], ["kitty", "--directory", path],
                 ["alacritty", "--working-directory", path], ["gnome-terminal", f"--working-directory={path}"],
                 ["xterm"]):
        if shutil.which(term[0]):
            subprocess.Popen(term, cwd=path, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
            return term[0]
    raise RuntimeError("No terminal emulator found")


def _check_name(name):
    if not name or "/" in name or name in (".", ".."):
        raise ValueError("Invalid name")
    return name


def mkdir(parent, name):
    p = os.path.join(_norm(parent), _check_name(name))
    os.mkdir(p)
    return p


def mkfile(parent, name):
    p = os.path.join(_norm(parent), _check_name(name))
    with open(p, "x"):
        pass
    return p


def rename(path, new_name):
    path = _norm(path)
    dst = os.path.join(os.path.dirname(path), _check_name(new_name))
    if os.path.exists(dst):
        raise FileExistsError(f"{new_name} already exists")
    os.rename(path, dst)
    return dst


def _unique(dst):
    if not os.path.exists(dst):
        return dst
    base, ext = os.path.splitext(dst)
    i = 2
    while os.path.exists(f"{base} ({i}){ext}"):
        i += 1
    return f"{base} ({i}){ext}"


def copy(paths, dest_dir):
    dest_dir = _norm(dest_dir)
    out = []
    for p in paths:
        p = _norm(p)
        dst = _unique(os.path.join(dest_dir, os.path.basename(p)))
        if os.path.isdir(p) and not os.path.islink(p):
            if dest_dir == p or dest_dir.startswith(p + os.sep):
                raise ValueError("Cannot copy a folder into itself")
            shutil.copytree(p, dst, symlinks=True)
        else:
            shutil.copy2(p, dst, follow_symlinks=False)
        out.append(dst)
    return out


def move(paths, dest_dir):
    dest_dir = _norm(dest_dir)
    out = []
    for p in paths:
        p = os.path.abspath(os.path.expanduser(p))
        if os.path.dirname(p) == dest_dir:
            continue
        if dest_dir == p or dest_dir.startswith(p + os.sep):
            raise ValueError("Cannot move a folder into itself")
        dst = _unique(os.path.join(dest_dir, os.path.basename(p)))
        shutil.move(p, dst)
        out.append(dst)
    return out


def _trash_fallback(path):
    """Minimal freedesktop.org Trash implementation (home trash only)."""
    tdir = os.path.join(HOME, ".local/share/Trash")
    files, info = os.path.join(tdir, "files"), os.path.join(tdir, "info")
    os.makedirs(files, exist_ok=True)
    os.makedirs(info, exist_ok=True)
    name = os.path.basename(path)
    dst = _unique(os.path.join(files, name))
    tname = os.path.basename(dst)
    with open(os.path.join(info, tname + ".trashinfo"), "w") as f:
        f.write("[Trash Info]\nPath=%s\nDeletionDate=%s\n" %
                (quote(path), datetime.now().strftime("%Y-%m-%dT%H:%M:%S")))
    shutil.move(path, dst)


def trash(paths):
    done = []
    for p in paths:
        p = os.path.abspath(os.path.expanduser(p))
        if p in ("/", HOME):
            raise ValueError(f"Refusing to trash {p}")
        ok = False
        if shutil.which("gio"):
            r = subprocess.run(["gio", "trash", "--", p], capture_output=True, text=True, timeout=60)
            ok = r.returncode == 0
        if not ok:
            _trash_fallback(p)
        done.append(p)
    return done


def delete_permanently(paths):
    done = []
    for p in paths:
        p = os.path.abspath(os.path.expanduser(p))
        if p in ("/", HOME) or len(Path(p).parts) <= 2:
            raise ValueError(f"Refusing to delete {p}")
        if os.path.isdir(p) and not os.path.islink(p):
            shutil.rmtree(p)
        else:
            os.remove(p)
        done.append(p)
    return done


def search(root, query, show_hidden=False, limit=SEARCH_LIMIT, timeout=6.0):
    root = _norm(root)
    q = query.lower().strip()
    if not q:
        return {"root": root, "query": query, "items": [], "truncated": False}
    results, deadline, truncated = [], time.monotonic() + timeout, False
    for dirpath, dirnames, filenames in os.walk(root):
        if not show_hidden:
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "__pycache__", ".git", "proc", "sys")]
        for n in dirnames + filenames:
            if not show_hidden and n.startswith("."):
                continue
            if q in n.lower():
                results.append(_entry(os.path.join(dirpath, n)))
                if len(results) >= limit:
                    truncated = True
                    break
        if truncated or time.monotonic() > deadline:
            truncated = True
            break
    return {"root": root, "query": query, "items": results, "truncated": truncated}


def _dir_size(path, deadline):
    total, count = 0, 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            try:
                total += os.lstat(os.path.join(dirpath, f)).st_size
                count += 1
            except OSError:
                pass
        if time.monotonic() > deadline:
            return total, count, True
    return total, count, False


def properties(path):
    path = os.path.abspath(os.path.expanduser(path))
    st = os.lstat(path)
    e = _entry(path)
    e.update({"mode": stat.filemode(st.st_mode), "owner": st.st_uid, "created": st.st_ctime,
              "accessed": st.st_atime, "mime": mimetypes.guess_type(path)[0] or ("inode/directory" if e["dir"] else "unknown")})
    try:
        import pwd
        e["owner"] = pwd.getpwuid(st.st_uid).pw_name
    except Exception:
        pass
    if e["dir"]:
        size, count, partial = _dir_size(path, time.monotonic() + 2.5)
        e.update({"size": size, "files": count, "partial": partial})
    if os.path.islink(path):
        e["target"] = os.readlink(path)
    return e


def read_text_preview(path, max_bytes=4000):
    path = _norm(path)
    with open(path, "rb") as f:
        data = f.read(max_bytes)
    if b"\0" in data:
        return None
    return data.decode("utf-8", errors="replace")
