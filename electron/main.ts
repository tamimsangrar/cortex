/**
 * Cortex — Electron main process.
 * Creates the application window, registers IPC handlers, and manages
 * the custom `app://` protocol for serving the Next.js static export.
 */
import { app, BrowserWindow, shell, protocol, net, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { registerIpcHandlers } from './ipc';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

/** Returns the root data directory for Cortex user data (~/BrainDump). */
function getCortexDataDir(): string {
  return path.join(app.getPath('home'), 'BrainDump');
}

/** Returns the path to the persisted window-state JSON file. */
function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): { width: number; height: number; x?: number; y?: number } {
  try {
    const data = fs.readFileSync(getWindowStatePath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveWindowState(bounds: Electron.Rectangle): void {
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds));
  } catch {}
}

// Register custom protocol to serve Next.js static export with proper routing
function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const outDir = path.join(__dirname, '..', 'out');
    let url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    // Try exact file first
    let fullPath = path.join(outDir, filePath);

    // If no extension, try .html (Next.js static export pattern)
    if (!path.extname(fullPath)) {
      const htmlPath = fullPath + '.html';
      if (fs.existsSync(htmlPath)) {
        fullPath = htmlPath;
      } else {
        // Try index.html inside directory
        const indexPath = path.join(fullPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          fullPath = indexPath;
        } else {
          // Fallback to index.html for SPA routing
          fullPath = path.join(outDir, 'index.html');
        }
      }
    }

    return net.fetch('file://' + fullPath);
  });
}

/** Creates all required data directories and the initial config.json on first launch. */
function ensureDataDirectories(): void {
  const base = getCortexDataDir();
  const dirs = [
    base,
    path.join(base, 'data'),
    path.join(base, 'data', 'imessage-export'),
    path.join(base, 'data', 'whatsapp-export'),
    path.join(base, 'data', 'web-clips'),
    path.join(base, 'data', 'notion-export'),
    path.join(base, 'data', 'obsidian-import'),
    path.join(base, 'raw'),
    path.join(base, 'raw', 'entries'),
    path.join(base, 'wiki'),
    path.join(base, 'chats'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create config.json if it doesn't exist
  const configPath = path.join(base, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      version: '0.1.0',
      createdAt: new Date().toISOString(),
    }, null, 2));
  }
}

function createWindow(): void {
  const bounds = loadWindowState();

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Save window bounds on resize/move
  const saveBounds = () => {
    if (mainWindow) {
      saveWindowState(mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadURL('app://./index.html');
  }

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Set dock icon in dev mode
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '..', 'public', 'icon.icns');
    if (fs.existsSync(iconPath)) {
      const { nativeImage } = require('electron');
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }
  }

  // Content Security Policy — restrict resource loading origins
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://models.inference.ai.azure.com https://github.com https://fonts.googleapis.com https://fonts.gstatic.com; " +
          "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
        ],
      },
    });
  });

  registerAppProtocol();
  ensureDataDirectories();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Expose the data directory path to IPC handlers
export { getCortexDataDir };
