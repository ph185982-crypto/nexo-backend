#!/bin/bash
set -e

echo "Building PRF Adaptive Study Platform for Vercel..."
echo "Build timestamp: $(date)"

# Ensure Python dependencies are fresh
pip install --no-cache-dir -r requirements.txt

# Pre-compile Python modules to ensure no bytecode caching issues
python -m py_compile api/index.py
python -m py_compile prf/app.py

echo "Build complete!"
