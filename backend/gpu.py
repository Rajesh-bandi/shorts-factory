"""Optional CUDA and NVENC helpers with fail-closed CPU fallbacks."""
import ctypes
import glob
import os
import subprocess

_cuda_state = None
_nvenc_state = None


def _nvidia_lib_dir():
    root = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".venv")
    paths = glob.glob(os.path.join(root, "lib", "python*", "site-packages", "nvidia"))
    return paths[0] if paths else None


def load_cuda_libs():
    """Preload CUDA runtime and cuBLAS from the project venv."""
    global _cuda_state
    if _cuda_state is not None:
        return _cuda_state
    base = _nvidia_lib_dir()
    if not base:
        _cuda_state = False
        return False
    patterns = (
        "cuda_runtime/lib/libcudart.so*",
        "cuda_nvrtc/lib/libnvrtc.so*",
        "cublas/lib/libcublas.so*",
        "cublas/lib/libcublasLt.so*",
    )
    loaded = 0
    for pattern in patterns:
        for path in glob.glob(os.path.join(base, pattern)):
            try:
                ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
                loaded += 1
            except OSError:
                continue
    _cuda_state = loaded > 0
    return _cuda_state


def cuda_available():
    global _cuda_state
    if not load_cuda_libs():
        return False
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        _cuda_state = False
        return False


def cuda_summary():
    if not cuda_available():
        return "CUDA unavailable"
    try:
        import ctranslate2

        return f"CUDA available ({ctranslate2.get_cuda_device_count()} device)"
    except Exception:
        return "CUDA unavailable"


def nvenc_available():
    """Check whether the installed ffmpeg exposes NVIDIA H.264 encoding."""
    global _nvenc_state
    if _nvenc_state is not None:
        return _nvenc_state
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        _nvenc_state = proc.returncode == 0 and "h264_nvenc" in proc.stdout
    except Exception:
        _nvenc_state = False
    return _nvenc_state