#!/bin/bash
# Double-click this file on a Mac to start Penny the way the setup wizard was told to.
# (Added after submission, v2.1.)
cd "$(dirname "$0")" || exit 1
./penny start || { echo; read -r -p "Penny stopped. Read the message above, then press Return to close. " _; }
