// Slimline Tactical — Editor UI
// Populates sidebar palette, handles button events, updates status bar

export class EditorUI {
    /**
     * @param {object} editorState — shared editor state
     * @param {import('./palette.js').EditorPalette} palette
     * @param {import('./placement.js').EditorPlacement} placement
     * @param {import('./export.js').EditorExport} exportManager
     * @param {object} callbacks — { onApplyGrid, onClearAll, onPreviewToggle, onPaletteSelect, onSpawnMode, onLightMode }
     */
    constructor(editorState, palette, placement, exportManager, callbacks) {
        this.editorState = editorState;
        this.palette = palette;
        this.placement = placement;
        this.exportManager = exportManager;
        this.callbacks = callbacks || {};

        // DOM references
        this.dom = {
            // Map settings
            mapName: document.getElementById('map-name'),
            gridWidth: document.getElementById('grid-width'),
            gridHeight: document.getElementById('grid-height'),
            groundTexture: document.getElementById('ground-texture'),
            btnApplyGrid: document.getElementById('btn-apply-grid'),

            // Object palette
            paletteList: document.getElementById('palette-list'),

            // Spawn buttons
            btnSpawnAbyss: document.getElementById('btn-spawn-abyss'),
            btnSpawnGermani: document.getElementById('btn-spawn-germani'),
            btnSpawnClear: document.getElementById('btn-spawn-clear'),

            // Light controls
            btnPlaceLight: document.getElementById('btn-place-light'),
            lightColor: document.getElementById('light-color'),
            lightIntensity: document.getElementById('light-intensity'),
            lightRadius: document.getElementById('light-radius'),
            lightHeight: document.getElementById('light-height'),

            // Toolbar
            btnExport: document.getElementById('btn-export'),
            btnImport: document.getElementById('btn-import'),
            btnPreview: document.getElementById('btn-preview'),
            btnClear: document.getElementById('btn-clear'),

            // Status bar
            statusTool: document.getElementById('status-tool'),
            statusTile: document.getElementById('status-tile'),
            statusObjects: document.getElementById('status-objects')
        };

        this._populatePalette();
        this._setupSettingsHandlers();
        this._setupSpawnHandlers();
        this._setupLightHandlers();
        this._setupToolbarHandlers();
    }

    // ============================================================
    // Palette Setup
    // ============================================================

    _populatePalette() {
        const items = this.palette.getItems();
        this.dom.paletteList.innerHTML = '';

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const el = document.createElement('div');
            el.className = 'palette-item';
            el.dataset.index = i;
            el.dataset.typeId = item.id;

            el.innerHTML = `
                <div class="palette-item-icon">${item.icon}</div>
                <div class="palette-item-info">
                    <div class="palette-item-name">${item.label}</div>
                    <div class="palette-item-cover">${item.description}</div>
                </div>
            `;

            el.addEventListener('click', () => {
                this._onPaletteItemClick(i, item.id);
            });

            this.dom.paletteList.appendChild(el);
        }

        this.paletteElements = this.dom.paletteList.querySelectorAll('.palette-item');
    }

    _onPaletteItemClick(index, typeId) {
        // If already selected, deselect
        if (this.palette.selectedIndex === index) {
            this.palette.deselect();
            this._clearAllActiveStates();
            this.updateStatus();
            return;
        }

        // Clear other active states (spawn, light)
        this._clearSpawnActiveStates();
        this._clearLightActiveState();

        this.palette.selectByIndex(index);
        this.highlightPaletteItem(index);
        this.updateStatus();

        if (this.callbacks.onPaletteSelect) {
            this.callbacks.onPaletteSelect(typeId);
        }
    }

    /**
     * Highlight a palette item by index.
     * @param {number} index
     */
    highlightPaletteItem(index) {
        // Remove selected from all
        for (const el of this.paletteElements) {
            el.classList.remove('selected');
        }
        // Add to target
        if (index >= 0 && index < this.paletteElements.length) {
            this.paletteElements[index].classList.add('selected');
        }
    }

    // ============================================================
    // Settings Handlers
    // ============================================================

    _setupSettingsHandlers() {
        // Map name sync
        this.dom.mapName.addEventListener('input', () => {
            this.editorState.mapName = this.dom.mapName.value;
        });

        // Ground texture sync
        this.dom.groundTexture.addEventListener('change', () => {
            this.editorState.groundTexture = this.dom.groundTexture.value;
        });

        // Apply grid button
        this.dom.btnApplyGrid.addEventListener('click', () => {
            const w = parseInt(this.dom.gridWidth.value, 10);
            const h = parseInt(this.dom.gridHeight.value, 10);

            if (isNaN(w) || isNaN(h) || w < 6 || w > 40 || h < 6 || h > 40) {
                alert('Grid size must be between 6 and 40.');
                return;
            }

            this.editorState.gridWidth = w;
            this.editorState.gridHeight = h;

            if (this.callbacks.onApplyGrid) {
                this.callbacks.onApplyGrid(w, h);
            }
        });
    }

    // ============================================================
    // Spawn Zone Handlers
    // ============================================================

    _setupSpawnHandlers() {
        this.dom.btnSpawnAbyss.addEventListener('click', () => {
            if (this.editorState.currentTool === 'spawn' &&
                this.editorState.spawnFaction === 'orderOfTheAbyss') {
                // Toggle off
                this._clearAllActiveStates();
                this.editorState.currentTool = 'select';
                this.editorState.spawnFaction = null;
            } else {
                this._clearAllActiveStates();
                this.editorState.currentTool = 'spawn';
                this.editorState.spawnFaction = 'orderOfTheAbyss';
                this.editorState.selectedObjectType = null;
                this.dom.btnSpawnAbyss.classList.add('active');
            }
            this.updateStatus();

            if (this.callbacks.onSpawnMode) {
                this.callbacks.onSpawnMode(this.editorState.spawnFaction);
            }
        });

        this.dom.btnSpawnGermani.addEventListener('click', () => {
            if (this.editorState.currentTool === 'spawn' &&
                this.editorState.spawnFaction === 'germani') {
                this._clearAllActiveStates();
                this.editorState.currentTool = 'select';
                this.editorState.spawnFaction = null;
            } else {
                this._clearAllActiveStates();
                this.editorState.currentTool = 'spawn';
                this.editorState.spawnFaction = 'germani';
                this.editorState.selectedObjectType = null;
                this.dom.btnSpawnGermani.classList.add('active');
            }
            this.updateStatus();

            if (this.callbacks.onSpawnMode) {
                this.callbacks.onSpawnMode(this.editorState.spawnFaction);
            }
        });

        this.dom.btnSpawnClear.addEventListener('click', () => {
            this._clearAllActiveStates();
            this.editorState.currentTool = 'select';
            this.editorState.spawnFaction = null;
            this.updateStatus();

            if (this.callbacks.onSpawnMode) {
                this.callbacks.onSpawnMode(null);
            }
        });
    }

    // ============================================================
    // Light Handlers
    // ============================================================

    _setupLightHandlers() {
        this.dom.btnPlaceLight.addEventListener('click', () => {
            if (this.editorState.currentTool === 'light') {
                // Toggle off
                this._clearAllActiveStates();
                this.editorState.currentTool = 'select';
            } else {
                this._clearAllActiveStates();
                this.editorState.currentTool = 'light';
                this.editorState.selectedObjectType = null;
                this.editorState.spawnFaction = null;
                this.dom.btnPlaceLight.style.borderColor = 'rgba(196, 164, 74, 0.6)';
                this.dom.btnPlaceLight.style.background = 'rgba(196, 164, 74, 0.15)';
            }
            this.updateStatus();

            if (this.callbacks.onLightMode) {
                this.callbacks.onLightMode(this.editorState.currentTool === 'light');
            }
        });
    }

    /**
     * Get current light settings from the UI controls.
     * @returns {{ color: string, intensity: number, radius: number, height: number }}
     */
    getLightSettings() {
        return {
            color: this.dom.lightColor.value,
            intensity: parseFloat(this.dom.lightIntensity.value) || 2.0,
            radius: parseFloat(this.dom.lightRadius.value) || 5.0,
            height: parseFloat(this.dom.lightHeight.value) || 0.5
        };
    }

    // ============================================================
    // Toolbar Handlers
    // ============================================================

    _setupToolbarHandlers() {
        // Export
        this.dom.btnExport.addEventListener('click', () => {
            this.exportManager.exportJSON(this.editorState, this.placement);
        });

        // Import
        this.dom.btnImport.addEventListener('click', async () => {
            const data = await this.exportManager.importJSON();
            if (data && this.callbacks.onImport) {
                this.callbacks.onImport(data);
            }
        });

        // Preview toggle
        this.dom.btnPreview.addEventListener('click', () => {
            this.editorState.previewMode = !this.editorState.previewMode;

            if (this.editorState.previewMode) {
                this.dom.btnPreview.classList.add('active');
            } else {
                this.dom.btnPreview.classList.remove('active');
            }

            if (this.callbacks.onPreviewToggle) {
                this.callbacks.onPreviewToggle(this.editorState.previewMode);
            }
        });

        // Clear All
        this.dom.btnClear.addEventListener('click', () => {
            if (confirm('Clear all objects, spawn zones, and lights?')) {
                if (this.callbacks.onClearAll) {
                    this.callbacks.onClearAll();
                }
                this.updateStatus();
            }
        });
    }

    // ============================================================
    // Status Bar
    // ============================================================

    /**
     * Update the status bar with current tool and tile info.
     * @param {number} [col]
     * @param {number} [row]
     */
    updateStatus(col, row) {
        // Tool display
        const tool = this.editorState.currentTool;
        let toolText = 'Select';

        if (tool === 'place' && this.editorState.selectedObjectType) {
            toolText = this.editorState.selectedObjectType;
        } else if (tool === 'spawn' && this.editorState.spawnFaction) {
            const faction = this.editorState.spawnFaction === 'orderOfTheAbyss' ? 'Abyss' : 'Germani';
            toolText = `Spawn (${faction})`;
        } else if (tool === 'light') {
            toolText = 'Place Light';
        }

        this.dom.statusTool.textContent = toolText;

        // Tile display
        if (col !== undefined && row !== undefined) {
            this.dom.statusTile.textContent = `${col}, ${row}`;
        }

        // Object count
        this.dom.statusObjects.textContent = String(this.placement.getObjectCount());
    }

    /**
     * Update the grid size input fields.
     * @param {number} width
     * @param {number} height
     */
    updateGridSizeDisplay(width, height) {
        this.dom.gridWidth.value = width;
        this.dom.gridHeight.value = height;
    }

    /**
     * Update settings fields from loaded map data.
     * @param {object} mapData
     */
    loadSettingsFromData(mapData) {
        if (mapData.name) {
            this.dom.mapName.value = mapData.name;
            this.editorState.mapName = mapData.name;
        }
        if (mapData.gridSize) {
            this.updateGridSizeDisplay(mapData.gridSize[0], mapData.gridSize[1]);
        }
        if (mapData.groundTexture) {
            this.dom.groundTexture.value = mapData.groundTexture;
            this.editorState.groundTexture = mapData.groundTexture;
        }
    }

    // ============================================================
    // Preview Mode
    // ============================================================

    /**
     * Toggle preview mode UI elements.
     * @param {boolean} preview
     */
    togglePreviewMode(preview) {
        const sidebar = document.getElementById('editor-sidebar');
        const toolbar = document.getElementById('editor-toolbar');
        const statusBar = document.getElementById('editor-status');
        const help = document.getElementById('editor-help');

        if (preview) {
            sidebar.style.display = 'none';
            toolbar.style.display = 'none';
            statusBar.style.display = 'none';
            help.style.display = 'none';
        } else {
            sidebar.style.display = '';
            toolbar.style.display = '';
            statusBar.style.display = '';
            help.style.display = '';
        }
    }

    // ============================================================
    // Active State Management
    // ============================================================

    _clearAllActiveStates() {
        this._clearPaletteSelection();
        this._clearSpawnActiveStates();
        this._clearLightActiveState();
        this.palette.deselect();
    }

    _clearPaletteSelection() {
        for (const el of this.paletteElements) {
            el.classList.remove('selected');
        }
    }

    _clearSpawnActiveStates() {
        this.dom.btnSpawnAbyss.classList.remove('active');
        this.dom.btnSpawnGermani.classList.remove('active');
    }

    _clearLightActiveState() {
        this.dom.btnPlaceLight.style.borderColor = '';
        this.dom.btnPlaceLight.style.background = '';
    }

    /**
     * Deselect all tools and return to select mode.
     */
    deselectAll() {
        this._clearAllActiveStates();
        this.editorState.currentTool = 'select';
        this.editorState.selectedObjectType = null;
        this.editorState.spawnFaction = null;
        this.updateStatus();
    }
}
