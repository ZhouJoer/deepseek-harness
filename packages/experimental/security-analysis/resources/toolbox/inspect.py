"""Measure local tools and test yescrypt; inventory mode records unavailable capabilities."""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

timeout = float(sys.argv[1])
inventory = "--inventory" in sys.argv[2:]
versions = {"python": sys.version.split()[0]}
for key, command in {"curl": ["curl", "--version"], "nuclei": ["nuclei", "-version"], "metasploit": ["msfconsole", "--version"], "john": ["john", "--list=build-info"]}.items():
    versions[key + ".installed"] = "yes" if shutil.which(command[0]) else "no"
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        versions[key] = (result.stdout + result.stderr).strip()[:4096] if result.returncode == 0 else "version query failed"
    except (OSError, subprocess.TimeoutExpired) as error:
        versions[key] = str(error)[:4096]
for key, package in {"python": "python3", "curl": "curl", "nuclei": "nuclei", "metasploit": "metasploit-framework", "john": "john", "libcrypt": "libcrypt1"}.items():
    result = subprocess.run(["dpkg-query", "-W", "-f=" + chr(36) + "{Version}", package], capture_output=True, text=True, timeout=timeout)
    versions[key + ".package"] = result.stdout.strip() if result.returncode == 0 else "not installed"
with tempfile.TemporaryDirectory(prefix="dsh-yescrypt-") as directory:
    root = pathlib.Path(directory)
    hashes, words, pot = root / "hashes", root / "words", root / "john.pot"
    hashes.write_text("$y$j9T$abcdefghijklmnop$y5seNhgdq.Qqq./zceoBr8Hr2UFuV8WLHK.CKgC9D25\n")
    words.write_text("dsh-toolbox-fixture\n")
    try:
        result = subprocess.run(["john", "--format=crypt", "--wordlist=" + str(words), "--pot=" + str(pot), str(hashes)], cwd=directory,
            env={**os.environ, "HOME": directory, "OMP_NUM_THREADS": "1"}, capture_output=True, text=True, timeout=timeout)
        supported = result.returncode == 0 and pot.exists() and pot.read_text().strip() == hashes.read_text().strip() + ":dsh-toolbox-fixture"
        versions["john.yescrypt"] = "passed" if supported else "failed"
        if not supported:
            versions["john.yescrypt.detail"] = (result.stdout + result.stderr)[-4096:]
    except (OSError, subprocess.TimeoutExpired) as error:
        versions["john.yescrypt"] = "unavailable"
        versions["john.yescrypt.detail"] = str(error)[:4096]
if not inventory and versions["john.yescrypt"] != "passed":
    raise RuntimeError("John yescrypt capability test failed: " + versions.get("john.yescrypt.detail", ""))
print(json.dumps(versions, sort_keys=True))
