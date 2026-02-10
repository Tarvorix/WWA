// Slimline Tactical — Editor Palette
// Defines available object types and manages palette selection state

import { CONSTANTS } from '../shared/constants.js';

/**
 * Available cover object types for placement in the editor.
 * Each entry defines the type ID, display label, default cover value,
 * default scale, and an icon character for the sidebar.
 */
const PALETTE_ITEMS = [
    {
        id: 'boulder',
        label: 'Boulder',
        cover: 'half',
        defaultScale: 1.0,
        icon: '⬤',
        description: 'Half cover'
    },
    {
        id: 'rock_cluster',
        label: 'Rock Cluster',
        cover: 'half',
        defaultScale: 0.8,
        icon: '⚬⚬',
        description: 'Half cover'
    },
    {
        id: 'column',
        label: 'Column',
        cover: 'full',
        defaultScale: 1.0,
        icon: '▮',
        description: 'Full cover'
    },
    {
        id: 'ruined_wall',
        label: 'Ruined Wall',
        cover: 'full',
        defaultScale: 1.0,
        icon: '▬',
        description: 'Full cover'
    },
    {
        id: 'barricade',
        label: 'Barricade',
        cover: 'half',
        defaultScale: 1.0,
        icon: '▭',
        description: 'Half cover'
    },
    {
        id: 'crater',
        label: 'Crater',
        cover: 'none',
        defaultScale: 1.0,
        icon: '◎',
        description: 'No cover'
    }
];

export class EditorPalette {
    /**
     * @param {object} editorState — shared editor state object
     */
    constructor(editorState) {
        this.editorState = editorState;
        this.items = PALETTE_ITEMS;
        this.selectedIndex = -1; // -1 = no selection (select mode)
    }

    /**
     * Get all palette items.
     * @returns {Array<object>}
     */
    getItems() {
        return this.items;
    }

    /**
     * Get the currently selected palette item, or null if none selected.
     * @returns {object|null}
     */
    getSelected() {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.items.length) {
            return null;
        }
        return this.items[this.selectedIndex];
    }

    /**
     * Select a palette item by type ID.
     * @param {string} typeId
     */
    select(typeId) {
        const index = this.items.findIndex(item => item.id === typeId);
        if (index !== -1) {
            this.selectedIndex = index;
            this.editorState.currentTool = 'place';
            this.editorState.selectedObjectType = typeId;
        }
    }

    /**
     * Select a palette item by index.
     * @param {number} index
     */
    selectByIndex(index) {
        if (index >= 0 && index < this.items.length) {
            this.selectedIndex = index;
            this.editorState.currentTool = 'place';
            this.editorState.selectedObjectType = this.items[index].id;
        }
    }

    /**
     * Clear the current palette selection (return to select mode).
     */
    deselect() {
        this.selectedIndex = -1;
        this.editorState.currentTool = 'select';
        this.editorState.selectedObjectType = null;
    }

    /**
     * Get palette item config by type ID.
     * @param {string} typeId
     * @returns {object|null}
     */
    getItemById(typeId) {
        return this.items.find(item => item.id === typeId) || null;
    }

    /**
     * Cycle through cover types for a given current cover value.
     * @param {string} currentCover — 'half' | 'full' | 'none'
     * @returns {string} — next cover type in cycle
     */
    cycleCover(currentCover) {
        const cycle = ['half', 'full', 'none'];
        const currentIndex = cycle.indexOf(currentCover);
        return cycle[(currentIndex + 1) % cycle.length];
    }

    /**
     * Get the default cover type for a given object type.
     * @param {string} typeId
     * @returns {string}
     */
    getDefaultCover(typeId) {
        const item = this.getItemById(typeId);
        return item ? item.cover : 'none';
    }

    /**
     * Get the default scale for a given object type.
     * @param {string} typeId
     * @returns {number}
     */
    getDefaultScale(typeId) {
        const item = this.getItemById(typeId);
        return item ? item.defaultScale : 1.0;
    }
}
