figma.showUI(__html__, { width: 1080, height: 720 });

let pendingApply = null;

async function checkSelection() {
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
        figma.ui.postMessage({
            type: "selection-changed",
            valid: false,
            message: "Select a 'Pallet color' component to continue",
        });
        return;
    }

    if (selection.length > 1) {
        figma.ui.postMessage({
            type: "selection-changed",
            valid: false,
            message: "Select only one 'Pallet color' component at a time",
        });
        return;
    }

    const node = selection[0];

    const isComponent =
        node.type === "COMPONENT" && node.name === "Pallet color";

    let isInstanceOfPalletColor = false;
    if (node.type === "INSTANCE") {
        const main = await node.getMainComponentAsync();
        isInstanceOfPalletColor = main != null && main.name === "Pallet color";
    }

    const isPalletColor = isComponent || isInstanceOfPalletColor;

    figma.ui.postMessage({
        type: "selection-changed",
        valid: isPalletColor,
        message: isPalletColor
            ? `"Pallet color" component selected: ${node.name}`
            : `"${node.name}" (type: ${node.type}) is not a "Pallet color" component`,
    });
}

figma.ui.onmessage = async (msg) => {
    if (msg.type === "ui-ready") {
        await checkSelection();
    } else if (msg.type === "check-selection") {
        await checkSelection();
    } else if (msg.type === "apply-colors") {
        try {
            const { category, description, color } = msg;

            const collection = await getOrCreateCollection("Colors");
            const allVars =
                await figma.variables.getLocalVariablesAsync("COLOR");
            const existingVars = allVars.filter(
                (v) =>
                    v.variableCollectionId === collection.id &&
                    v.name.startsWith(`${category}/`),
            );

            if (existingVars.length > 0) {
                pendingApply = { category, description, color };
                figma.ui.postMessage({
                    type: "confirm-overwrite",
                    category,
                });
            } else {
                await applyColorsToPallet(category, description, color);
            }
        } catch (e) {
            console.error(e);
            figma.notify("❌ " + e.message);
        }
    } else if (msg.type === "confirm-overwrite") {
        if (pendingApply) {
            try {
                await applyColorsToPallet(
                    pendingApply.category,
                    pendingApply.description,
                    pendingApply.color,
                );
            } catch (e) {
                console.error(e);
                figma.notify("❌ " + e.message);
            } finally {
                pendingApply = null;
            }
        }
    } else if (msg.type === "cancel-overwrite") {
        pendingApply = null;
        figma.notify("Operation cancelled");
    } else if (msg.type === "preview-all") {
        try {
            const base = hexToRgbNormalized(msg.color);
            const shades = generateShades(base);
            const shadesWithHex = shades.map((s) => ({
                step: s.step,
                hex: rgbToHex(s.color),
            }));
            figma.ui.postMessage({
                type: "preview-all-result",
                shades: shadesWithHex,
            });
        } catch (e) {
            console.error(e);
        }
    }
};

figma.on("selectionchange", async () => {
    await checkSelection();
});

async function applyColorsToPallet(category, description, hexColor) {
    const selection = figma.currentPage.selection;

    if (selection.length !== 1) {
        throw new Error("You must select exactly one Pallet color component");
    }

    const palletNode = selection[0];

    const isComponent =
        palletNode.type === "COMPONENT" && palletNode.name === "Pallet color";

    let isInstanceOfPalletColor = false;
    if (palletNode.type === "INSTANCE") {
        const main = await palletNode.getMainComponentAsync();
        isInstanceOfPalletColor = main != null && main.name === "Pallet color";
    }

    if (!isComponent && !isInstanceOfPalletColor) {
        throw new Error(
            'The selected element must be a "Pallet color" component or an instance of one',
        );
    }

    const baseColor = hexToRgbNormalized(hexColor);
    const shades = generateShades(baseColor);

    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    const appliedColors = [];

    const collection = await getOrCreateCollection("Colors");
    const modeId = collection.modes[0].modeId;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const shade = shades[i];
        const colorCardName = `Color card ${i + 1}`;

        const variableName = `${category}/${step}`;
        const variable = await getOrCreateVariable(
            variableName,
            collection,
            "COLOR",
        );
        variable.setValueForMode(modeId, shade.color);

        const colorCard = findChildByName(palletNode, colorCardName);

        if (colorCard) {
            const rectangleSup = findChildByName(colorCard, "rectangle sup");
            if (rectangleSup && "fills" in rectangleSup) {
                const basePaint = {
                    type: "SOLID",
                    color: {
                        r: shade.color.r,
                        g: shade.color.g,
                        b: shade.color.b,
                    },
                };
                const boundPaint = figma.variables.setBoundVariableForPaint(
                    basePaint,
                    "color",
                    variable,
                );
                rectangleSup.fills = [boundPaint];
            }

            const colorText = findChildByName(colorCard, "_color");
            if (colorText && colorText.type === "TEXT") {
                await figma.loadFontAsync(colorText.fontName);
                colorText.characters = rgbToHex(shade.color);
            }

            const nameText = findChildByName(colorCard, "_name");
            if (nameText && nameText.type === "TEXT") {
                await figma.loadFontAsync(nameText.fontName);
                nameText.characters = `${step}`;
            }

            appliedColors.push({ step, hex: rgbToHex(shade.color) });
        }
    }

    const tableInfo = findChildByName(palletNode, "Table info");
    if (tableInfo) {
        const descText = findChildByName(tableInfo, "description");
        if (descText && descText.type === "TEXT") {
            await figma.loadFontAsync(descText.fontName);
            descText.characters = description;
        }

        const nameText = findChildByName(tableInfo, "name");
        if (nameText && nameText.type === "TEXT") {
            await figma.loadFontAsync(nameText.fontName);
            nameText.characters = category;
        }
    }

    figma.notify(`✅ Colors applied to "${palletNode.name}"`);

    const exportText = appliedColors
        .map((c) => `${category}/${c.step} = ${c.hex}`)
        .join("\n");

    figma.ui.postMessage({ type: "show-export", text: exportText });
}

async function getOrCreateCollection(name) {
    const collections =
        await figma.variables.getLocalVariableCollectionsAsync();
    let collection = collections.find((c) => c.name === name);
    if (!collection) {
        collection = figma.variables.createVariableCollection(name);
    }
    return collection;
}

async function getOrCreateVariable(name, collection, type) {
    const allVars = await figma.variables.getLocalVariablesAsync("COLOR");
    const existing = allVars.find(
        (v) => v.name === name && v.variableCollectionId === collection.id,
    );
    if (existing) return existing;
    return figma.variables.createVariable(name, collection, type);
}

function findChildByName(parent, name) {
    if (!("children" in parent)) return null;

    for (const child of parent.children) {
        if (child.name === name) return child;
        if ("children" in child) {
            const found = findChildByName(child, name);
            if (found) return found;
        }
    }

    return null;
}

function hexToRgbNormalized(hex) {
    if (!hex) throw new Error("Invalid color");
    hex = hex.replace("#", "");
    if (hex.length !== 6) throw new Error("Invalid HEX format");
    return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
    };
}

function clamp(v) {
    return Math.min(1, Math.max(0, v));
}

function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const c = max - min;
    const l = (max + min) / 2;

    if (c === 0) return { h: 0, s: 0, l };

    let h;
    if (max === r) h = ((g - b) / c) % 6;
    else if (max === g) h = (b - r) / c + 2;
    else h = (r - g) / c + 4;
    h = h / 6;
    if (h < 0) h += 1;

    const s = c / (1 - Math.abs(2 * l - 1));
    return { h, s, l };
}

function hslToRgb(h, s, l) {
    if (s === 0) return { r: l, g: l, b: l };

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = l - c / 2;

    let r = 0,
        g = 0,
        b = 0;
    const h6 = h * 6;
    if (h6 < 1) {
        r = c;
        g = x;
        b = 0;
    } else if (h6 < 2) {
        r = x;
        g = c;
        b = 0;
    } else if (h6 < 3) {
        r = 0;
        g = c;
        b = x;
    } else if (h6 < 4) {
        r = 0;
        g = x;
        b = c;
    } else if (h6 < 5) {
        r = x;
        g = 0;
        b = c;
    } else {
        r = c;
        g = 0;
        b = x;
    }

    return {
        r: clamp(r + m),
        g: clamp(g + m),
        b: clamp(b + m),
    };
}

function generateShades(base) {
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    const { h, s, l } = rgbToHsl(base.r, base.g, base.b);

    return steps.map((step) => {
        let L;
        if (step === 500) {
            L = l;
        } else if (step < 500) {
            const t = 0.255 + 0.58 * ((400 - step) / 350);
            L = l + (1 - l) * t;
        } else {
            const t = 0.17 + 0.5 * ((step - 600) / 300);
            L = l * (1 - t);
        }

        const rgb = hslToRgb(h, s, L);
        return {
            step,
            color: { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 },
        };
    });
}

function rgbToHex(color) {
    const r = Math.round(color.r * 255)
        .toString(16)
        .padStart(2, "0");
    const g = Math.round(color.g * 255)
        .toString(16)
        .padStart(2, "0");
    const b = Math.round(color.b * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${r}${g}${b}`.toUpperCase();
}
