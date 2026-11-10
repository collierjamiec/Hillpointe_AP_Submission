#!/bin/bash
# Double-click this file on a Mac to install Penny and open the setup wizard.
# (Added after submission, v2.1.) It only touches this folder: a private .venv is made here, nothing system-wide.
cd "$(dirname "$0")" || exit 1
echo "Installing Penny. This takes about a minute the first time."
echo
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Get it at https://www.python.org/downloads/ and then double-click this file again."
  read -r -p "Press Return to close this window. " _
  exit 1
fi
python3 ap.py install || { echo; read -r -p "The install did not finish. Read the message above, then press Return to close. " _; exit 1; }
echo
./penny setup
