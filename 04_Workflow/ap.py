"""Entry point used by the penny launchers.

  penny install   set up everything Penny needs (one time)
  penny check     confirm Penny is ready to run
"""
import os
import subprocess
import sys
import venv
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"


def venv_python():
    """The Python inside Penny's private environment, on Windows or anywhere else."""
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def install():
    """Make Penny's private environment, install its libraries, and check that everything is ready."""
    print("Penny setup\n")
    if sys.version_info < (3, 9):
        sys.exit(f"Python 3.9 or newer is needed. This is {sys.version.split()[0]}. Get it at python.org/downloads, then run install again.")
    print(f"1. Python {sys.version.split()[0]} found.")
    if not venv_python().exists():
        print("2. Creating a private environment (.venv) so nothing else on this computer is touched...")
        venv.create(VENV, with_pip=True)
    else:
        print("2. Private environment already exists.")
    print("3. Installing the libraries (pdfplumber, openpyxl, reportlab). This takes about a minute...")
    r = subprocess.run([str(venv_python()), "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", str(HERE / "requirements.txt")])
    if r.returncode != 0:
        sys.exit("Install failed. Check your internet connection and run the install command again. If it keeps failing, copy the message above and ask for help.")
    print("4. Checking everything works...\n")
    r = subprocess.run([str(venv_python()), str(HERE / "ap.py"), "check"])
    if r.returncode == 0:
        print("\nNext: set Penny up in your browser with  ./penny setup  (a few screens: your invoices, who signs in, settings).")
    sys.exit(r.returncode)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "install":
        install()
    try:
        from ap_workflow.cli import main
    except ModuleNotFoundError as e:
        sys.exit(f"Penny is missing a library ({e.name}). Run the one-time setup first:  ./penny install")
    main()
