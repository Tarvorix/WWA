// Slimline Tactical — Editor Export / Import
// Handles exporting map data to JSON and importing from JSON files

export class EditorExport {
    constructor() {
        // No state needed
    }

    /**
     * Export the current editor state as a JSON file download.
     * Assembles the full map data from editor state and placement data,
     * then triggers a browser download.
     *
     * @param {object} editorState — the shared editor state
     * @param {import('./placement.js').EditorPlacement} placement — placement manager
     */
    exportJSON(editorState, placement) {
        const { objects, spawnZones } = placement.getAllPlacedData();
        const lights = placement.getAllLightData();

        const mapData = {
            name: editorState.mapName || 'Untitled Map',
            gridSize: [editorState.gridWidth, editorState.gridHeight],
            tileSize: 2.0,
            groundTexture: editorState.groundTexture || 'dirt',
            spawnZones: spawnZones,
            objects: objects,
            lights: lights
        };

        const jsonString = JSON.stringify(mapData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // Create temporary link and trigger download
        const link = document.createElement('a');
        link.href = url;

        // Sanitize map name for filename
        const safeName = (editorState.mapName || 'untitled-map')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        link.download = `${safeName}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Import a JSON map file via browser file dialog.
     * Opens a file picker, reads the selected JSON, validates it,
     * and returns the parsed map data.
     *
     * @returns {Promise<object|null>} — parsed map data, or null if cancelled/invalid
     */
    async importJSON() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.style.display = 'none';

            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) {
                    resolve(null);
                    return;
                }

                const reader = new FileReader();

                reader.onload = (evt) => {
                    try {
                        const data = JSON.parse(evt.target.result);

                        // Validate required fields
                        if (!this._validateMapData(data)) {
                            console.error('Invalid map data format');
                            alert('Invalid map file format. Please check the JSON structure.');
                            resolve(null);
                            return;
                        }

                        resolve(data);
                    } catch (err) {
                        console.error('Failed to parse JSON:', err);
                        alert('Failed to parse JSON file. Please check the file format.');
                        resolve(null);
                    }
                };

                reader.onerror = () => {
                    console.error('Failed to read file');
                    alert('Failed to read the selected file.');
                    resolve(null);
                };

                reader.readAsText(file);
            });

            // Handle cancel (no file selected)
            input.addEventListener('cancel', () => {
                resolve(null);
            });

            document.body.appendChild(input);
            input.click();
            document.body.removeChild(input);
        });
    }

    /**
     * Validate that imported map data has the required structure.
     * @param {object} data
     * @returns {boolean}
     * @private
     */
    _validateMapData(data) {
        if (!data || typeof data !== 'object') return false;

        // Must have gridSize as [width, height]
        if (!Array.isArray(data.gridSize) || data.gridSize.length !== 2) return false;
        if (typeof data.gridSize[0] !== 'number' || typeof data.gridSize[1] !== 'number') return false;

        // gridSize values must be reasonable
        if (data.gridSize[0] < 6 || data.gridSize[0] > 40) return false;
        if (data.gridSize[1] < 6 || data.gridSize[1] > 40) return false;

        // Must have tileSize
        if (typeof data.tileSize !== 'number' || data.tileSize <= 0) return false;

        // Objects array is optional but must be valid if present
        if (data.objects && !Array.isArray(data.objects)) return false;

        // Spawn zones are optional but must be valid if present
        if (data.spawnZones && typeof data.spawnZones !== 'object') return false;

        // Lights array is optional but must be valid if present
        if (data.lights && !Array.isArray(data.lights)) return false;

        return true;
    }

    /**
     * Validate a single object entry from map data.
     * @param {object} obj
     * @returns {boolean}
     * @private
     */
    _validateObjectEntry(obj) {
        if (!obj || typeof obj !== 'object') return false;
        if (typeof obj.type !== 'string') return false;
        if (!Array.isArray(obj.tile) || obj.tile.length !== 2) return false;
        if (typeof obj.tile[0] !== 'number' || typeof obj.tile[1] !== 'number') return false;
        return true;
    }
}
