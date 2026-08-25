#!/usr/bin/env python3
"""Build the fixed, target-specific offline Vision wheelhouse."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import subprocess
import tempfile
import urllib.request
import zipfile


WHEELS = {
    "darwin-arm64": (
        ("pillow", "pillow-12.3.0-cp312-cp312-macosx_11_0_arm64.whl", 4_780_323, "ffd0c5368496f41b0944be820fcb7a838aa6e623d250b01acf2643939c3f99d7", "https://files.pythonhosted.org/packages/d8/66/9a386a92561f402389a4fc70c18838bf6d35eb5eb5c6850b4b2dc64f5048/pillow-12.3.0-cp312-cp312-macosx_11_0_arm64.whl"),
        ("numpy", "numpy-2.4.6-cp312-cp312-macosx_11_0_arm64.whl", 14_699_246, "ebfb099f8dcf083deef3ac1ca4c1503f387cf76296fcb3816b66f5ecb5f54fdb", "https://files.pythonhosted.org/packages/ea/12/92c4c131527599e8288d6918e888d88726f84d805d784b771f32408aeaef/numpy-2.4.6-cp312-cp312-macosx_11_0_arm64.whl"),
        ("vtracer", "vtracer-0.6.15-cp312-cp312-macosx_11_0_arm64.whl", 949_508, "27a97dfbe9b6d334b2238823a860521f536be252586856b06f5f03199f0cd5d3", "https://files.pythonhosted.org/packages/c0/ad/1a375fc2362461e352cc4018e4880e3643d0c6064a03aa15f69646f20f2b/vtracer-0.6.15-cp312-cp312-macosx_11_0_arm64.whl"),
    ),
    "darwin-x64": (
        ("pillow", "pillow-12.3.0-cp312-cp312-macosx_10_13_x86_64.whl", 5_345_969, "ba09209fbe443b4acccebe845d8a138b89a8f4fbaeedd44953490b5315d5e965", "https://files.pythonhosted.org/packages/37/bf/fb3ebff8ddcb76aac5a01389251bbbb9519922a9b520d8247c1ca864a25d/pillow-12.3.0-cp312-cp312-macosx_10_13_x86_64.whl"),
        ("numpy", "numpy-2.4.6-cp312-cp312-macosx_10_13_x86_64.whl", 16_689_119, "001fbb8e08d942dd57599e781f2472269ee7f2755fae407b4f67b2f0b17da3f1", "https://files.pythonhosted.org/packages/95/2a/3d7b5ac8aac24feaf9ad7ed58f45b0bbc06d37e4338ae84c9f2298b570f9/numpy-2.4.6-cp312-cp312-macosx_10_13_x86_64.whl"),
        ("vtracer", "vtracer-0.6.15-cp312-cp312-macosx_10_12_x86_64.whl", 1_006_035, "45d8be7043c98866bb68ae8e60706ea3bc6acdcc8423f5c2e28eb9238207411e", "https://files.pythonhosted.org/packages/31/83/24f245a38bdcd5597cf8e2a91884312347eef4a1bdd0914416a353e07db2/vtracer-0.6.15-cp312-cp312-macosx_10_12_x86_64.whl"),
    ),
    "win32-x64": (
        ("pillow", "pillow-12.3.0-cp312-cp312-win_amd64.whl", 7_227_137, "a2b55dd6b2a4c4b7d87ffa56bdb33fdc5fdb9a462173861a7bc097f17d91cb09", "https://files.pythonhosted.org/packages/45/89/da2f7971a317f83d807fdd4065c0af40208e59e692cc43d315a71a0e96d1/pillow-12.3.0-cp312-cp312-win_amd64.whl"),
        ("numpy", "numpy-2.4.6-cp312-cp312-win_amd64.whl", 12_321_687, "d8e8286dd7cea7895157318d1b91cdacac64c479f3cbc8dce548331728484751", "https://files.pythonhosted.org/packages/ab/ca/feab00bd44aa5fe1ad2c18f08b4d3bb92e26484b0b1d1443897809ed528c/numpy-2.4.6-cp312-cp312-win_amd64.whl"),
        ("vtracer", "vtracer-0.6.15-cp312-cp312-win_amd64.whl", 842_765, "b0f08b66734e41872d4ac343ed6d08870b3235346def3e112e10b3b2443e619e", "https://files.pythonhosted.org/packages/b1/29/f2e54143938e229ead2c098488d8f92f3464d723a0f52efbf6237926b58f/vtracer-0.6.15-cp312-cp312-win_amd64.whl"),
    ),
}
VERSIONS = {"pillow": "12.3.0", "numpy": "2.4.6", "vtracer": "0.6.15"}
MACH_MAGICS = {b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe"}
FAT_MAGICS = {b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}
MAX_ARCHIVE_FILES = 5_000
MAX_EXPANDED_BYTES = 256 * 1024 * 1024


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_name(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and "\\" not in name and not path.is_absolute() and ".." not in path.parts


def binary_kind(data: bytes) -> str | None:
    if data[:4] in MACH_MAGICS or data[:4] in FAT_MAGICS:
        return "mach-o"
    if data[:4] == b"\x7fELF":
        return "elf"
    if data[:2] != b"MZ" or len(data) < 64:
        return None
    offset = struct.unpack_from("<I", data, 0x3C)[0]
    return "pe" if offset <= len(data) - 6 and data[offset : offset + 4] == b"PE\0\0" else None


def assert_arch(data: bytes, target: str) -> None:
    kind = binary_kind(data)
    if target.startswith("darwin-"):
        if kind != "mach-o":
            raise RuntimeError(f"{target} wheel contains a non-Mach-O binary")
        expected = 0x0100000C if target == "darwin-arm64" else 0x01000007
        if data[:4] in FAT_MAGICS:
            little = data[:4] in {b"\xbe\xba\xfe\xca", b"\xbf\xba\xfe\xca"}
            byteorder = "little" if little else "big"
            count = int.from_bytes(data[4:8], byteorder)
            entry_size = 32 if data[:4] in {b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"} else 20
            if count < 1 or count > 16 or 8 + count * entry_size > len(data):
                raise RuntimeError("Vision wheel contains an invalid fat Mach-O header")
            cpus = {int.from_bytes(data[8 + index * entry_size : 12 + index * entry_size], byteorder) for index in range(count)}
        else:
            little = data[:4] in {b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe"}
            cpus = {int.from_bytes(data[4:8], "little" if little else "big")}
        if cpus != {expected}:
            raise RuntimeError(f"{target} wheel contains the wrong Mach-O architectures: {sorted(cpus)}")
    elif kind != "pe":
        raise RuntimeError("Windows wheel contains a non-PE binary")
    else:
        offset = struct.unpack_from("<I", data, 0x3C)[0]
        if struct.unpack_from("<H", data, offset + 4)[0] != 0x8664:
            raise RuntimeError("Windows wheel contains a non-x64 PE binary")


def fetch(url: str, expected_bytes: int, expected_sha: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "e-mate-vision-wheel-builder/2.0.13"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(expected_bytes + 1)
    if len(data) != expected_bytes or sha256(data) != expected_sha:
        raise RuntimeError("Vision wheel source identity mismatch")
    return data


def validate_archive(raw: bytes, target: str) -> int:
    native = 0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_ARCHIVE_FILES or sum(info.file_size for info in infos) > MAX_EXPANDED_BYTES:
            raise RuntimeError("Vision wheel archive limits exceeded")
        seen: set[str] = set()
        for info in infos:
            if not safe_name(info.filename) or info.filename in seen or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise RuntimeError("Vision wheel contains an unsafe entry")
            seen.add(info.filename)
            if info.is_dir():
                continue
            data = archive.read(info)
            kind = binary_kind(data)
            if kind is not None:
                assert_arch(data, target)
                native += 1
    if native == 0:
        raise RuntimeError("Vision wheel contains no native binary")
    return native


def record_bytes(root: Path, record: Path) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix()
        if path == record:
            writer.writerow((relative, "", ""))
            continue
        data = path.read_bytes()
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")
        writer.writerow((relative, f"sha256={digest}", str(len(data))))
    return stream.getvalue().encode("utf-8")


def repack_macos(raw: bytes, target: str, output: Path) -> int:
    with tempfile.TemporaryDirectory(prefix="e-mate-vision-wheel-") as temporary:
        root = Path(temporary)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                destination = root.joinpath(*PurePosixPath(info.filename).parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(info))
                os.chmod(destination, 0o644)
        binaries = []
        for path in sorted(item for item in root.rglob("*") if item.is_file()):
            data = path.read_bytes()
            if binary_kind(data) is None:
                continue
            assert_arch(data, target)
            subprocess.run(
                ["/usr/bin/codesign", "--force", "--sign", "-", "--timestamp=none", str(path)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            subprocess.run(
                ["/usr/bin/codesign", "--verify", "--strict", str(path)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            binaries.append(path)
        if not binaries:
            raise RuntimeError("Vision wheel contains no native binary")
        records = list(root.glob("*.dist-info/RECORD"))
        if len(records) != 1:
            raise RuntimeError("Vision wheel RECORD is missing or ambiguous")
        records[0].write_bytes(record_bytes(root, records[0]))
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(item for item in root.rglob("*") if item.is_file()):
                info = zipfile.ZipInfo(path.relative_to(root).as_posix(), (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        return len(binaries)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--targets", required=True)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    if manifest.get("name") != "@e-mate/dsh-plugin-vision-toolkit":
        raise RuntimeError("Vision wheel root is not the component package")
    targets = args.targets.split(",")
    if not targets or len(set(targets)) != len(targets) or any(target not in WHEELS for target in targets):
        raise RuntimeError("unsupported Vision wheel target set")
    wheel_root = root / "runtime" / "wheels"
    shutil.rmtree(wheel_root, ignore_errors=True)
    hashes: dict[str, list[str]] = {name: [] for name in VERSIONS}
    summary = []
    for target in targets:
        for package, filename, expected_bytes, source_sha, url in WHEELS[target]:
            raw = fetch(url, expected_bytes, source_sha)
            output = wheel_root / target / filename
            if target.startswith("darwin-"):
                native = repack_macos(raw, target, output)
                result = output.read_bytes()
                with tempfile.TemporaryDirectory(prefix="e-mate-vision-wheel-check-") as temporary:
                    duplicate = Path(temporary) / filename
                    if repack_macos(raw, target, duplicate) != native or duplicate.read_bytes() != result:
                        raise RuntimeError("Vision wheel output is not reproducible on this build host")
            else:
                native = validate_archive(raw, target)
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(raw)
                result = output.read_bytes()
                if result != raw:
                    raise RuntimeError("Vision wheel output differs from its verified source")
            digest = sha256(result)
            hashes[package].append(digest)
            summary.append({"target": target, "file": filename, "bytes": len(result), "sha256": digest, "native_files": native})
    requirements = []
    for package in ("pillow", "numpy", "vtracer"):
        requirements.append(f"{package}=={VERSIONS[package]} " + " ".join(f"--hash=sha256:{digest}" for digest in sorted(hashes[package])))
    (root / "runtime" / "requirements.lock").write_text("\n".join(requirements) + "\n", encoding="utf-8")
    print(json.dumps(summary, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
