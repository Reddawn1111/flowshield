import subprocess
import webbrowser
import time
import os
import sys

def main():
    print("=" * 75)
    print(" FLOWSHIELD 3D: Flood Simulation & Early Warning Dashboard")
    print("=" * 75)
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    # Prepend Node.js to PATH
    node_dir = r"C:\Program Files\nodejs"
    if os.path.exists(node_dir) and node_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = node_dir + os.pathsep + os.environ.get("PATH", "")
        
    print("[*] Launching Vite development server on http://localhost:5173 ...")
    
    # Start dev server
    npm_cmd = os.path.join(node_dir, "npm.cmd") if os.path.exists(node_dir) else "npm"
    proc = subprocess.Popen([npm_cmd, "run", "dev"], cwd=script_dir)
    
    # Wait for server to initialize
    time.sleep(2.0)
    print("[*] Opening browser at http://localhost:5173 ...")
    webbrowser.open("http://localhost:5173")
    
    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\n[*] Shutting down FLOWSHIELD server.")
        proc.terminate()

if __name__ == "__main__":
    main()
