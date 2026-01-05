# Tool Importer Development Guide — ncSender

## Overview

Tool importers are plugins that extend ncSender's tool management system by allowing users to import tool libraries from external sources. Instead of manually entering tool data, users can import entire tool libraries from CAM software, spreadsheets, or other tool management systems.

Tool importers appear in the **Tools** tab under the **Import** dropdown menu, alongside the default JSON import option.

**Plugin Category**: `tool-importer` - Tool importer plugins use this non-exclusive category and do not require a priority value since they only provide UI integration without event handlers.

## When to Create a Tool Importer

Create a tool importer plugin when you want to:
- Import tool libraries from CAM software (e.g., Fusion 360, Vectric, Carbide Create)
- Convert tool data from spreadsheets (CSV, Excel)
- Import from third-party tool management systems
- Support proprietary tool library formats

## Tool Data Format

All tool importers must return an array of tool objects that conform to ncSender's tool schema:

```javascript
{
  id: 0,                    // Temporary ID (will be reassigned during import)
  toolNumber: 5,            // ATC slot number (null if not assigned)
  name: "1/4\" End Mill",   // Tool description (required, non-empty)
  type: "flat",             // Tool type (see types below)
  diameter: 6.35,           // Cutting diameter in mm (required, > 0)
  offsets: {
    tlo: 0,                // Tool length offset in mm (default 0, measured on machine)
    x: 0,                  // X offset in mm
    y: 0,                  // Y offset in mm
    z: 0                   // Z offset in mm
  },
  metadata: {
    notes: "",             // Optional notes
    image: "",             // Optional image URL or data URI
    sku: ""                // Optional product SKU
  }
}
```

### Tool Types

Valid tool types:
- `flat` - Flat end mill
- `ball` - Ball end mill
- `v-bit` - V-bit or chamfer mill
- `surfacing` - Surfacing bit
- `thread-mill` - Thread mill
- `drill` - Drill bit
- `engraving` - Engraving bit
- `other` - Other/custom tool

### Important Validation Rules

1. **Diameter**: Must be greater than 0 (in mm)
2. **Name**: Must not be empty or whitespace only
3. **Tool Number**: Can be `null` (no ATC slot) or a positive integer
4. **ID**: Use stable IDs from source system when possible (see ID Strategy below)
5. **TLO (Tool Length Offset)**: Should default to 0 - this must be measured on the machine

### ID Strategy for Duplicate Prevention

**Recommended Approach**: Use the source system's tool identifier as the ncSender ID.

**Why?** This prevents duplicate tools when re-importing the same library:
- First import: Creates tools with IDs from source system
- Re-import: ncSender detects existing IDs and prompts to replace or cancel
- Result: No duplicates, enables update workflow

**Example (Fusion 360)**:
```javascript
// Use Fusion tool number as ID
const ncSenderTool = {
  id: fusionTool['post-process'].number,  // Stable ID from Fusion
  toolNumber: fusionTool['post-process'].turret || null,  // ATC slot
  // ... other fields
};
```

**Fallback (when no stable ID exists)**:
- Use temporary high IDs (100000+) 
- Accept that re-imports will create duplicates
- Document this limitation for users

### Critical Field Mappings

**Tool Number vs. Tool Identifier:**
- `toolNumber` in ncSender represents the **ATC (Automatic Tool Changer) slot number**
- This is NOT the same as a tool identifier in CAM software (e.g., Fusion 360's tool number)
- Map the CAM software's **turret/slot/pocket** field to ncSender's `toolNumber`
- If the CAM tool is not assigned to a slot (e.g., turret = 0), set `toolNumber: null`

**Tool Length Offset (TLO):**
- DO NOT import TLO values from CAM software
- Always set `offsets.tlo: 0` during import
- TLO must be measured on the actual machine using a probe or touch-off
- CAM software measurements (like Fusion 360's `assemblyGaugeLength`) are for simulation only

## Creating a Tool Importer Plugin

### 1. Plugin Structure

```
~/.ncSender/plugins/
└── com.example.mytoolimporter/
    ├── manifest.json
    ├── index.js
    └── config.json (optional)
```

Platform-specific paths:
- **macOS**: `~/Library/Application Support/ncSender/plugins/`
- **Windows**: `%APPDATA%\ncSender\plugins\`
- **Linux**: `~/.config/ncSender/plugins/`

### 2. Manifest File

```json
{
  "id": "com.example.mytoolimporter",
  "name": "My Tool Importer",
  "version": "1.0.0",
  "minAppVersion": "0.3.0",
  "author": "Your Name",
  "description": "Import tools from MyCAM software",
  "entry": "index.js",
  "category": "tool-importer",
  "permissions": []
}
```

**Note**: Tool importer plugins should use the `tool-importer` category and do not need a `priority` field.

### 3. Plugin Implementation

```javascript
// index.js

/**
 * Import handler function
 * @param {string} fileContent - Raw file content as string
 * @param {string} fileName - Original filename
 * @returns {Promise<Array>} - Array of ncSender tool objects
 * @throws {Error} - With user-friendly error message
 */
async function importMyTools(fileContent, fileName) {
  try {
    // 1. Parse the file content
    const data = JSON.parse(fileContent);
    
    // 2. Validate the format
    if (!data.tools || !Array.isArray(data.tools)) {
      throw new Error('Invalid file format. Expected "tools" array.');
    }
    
    // 3. Convert to ncSender format
    const convertedTools = [];
    const skippedTools = [];
    let tempIdCounter = 100000; // Use high IDs to avoid conflicts
    
    for (const tool of data.tools) {
      try {
        // Validate required fields
        if (!tool.diameter || tool.diameter <= 0) {
          skippedTools.push(`Tool "${tool.name}" has invalid diameter`);
          continue;
        }
        
        if (!tool.name || tool.name.trim() === '') {
          skippedTools.push('Tool missing name');
          continue;
        }
        
        // Build ncSender tool object
        const ncSenderTool = {
          id: tempIdCounter++,
          toolNumber: (tool.slot && tool.slot > 0) ? tool.slot : null, // ATC slot, not tool ID
          name: tool.name.trim(),
          type: mapToolType(tool.type),
          diameter: convertToMm(tool.diameter, tool.units),
          offsets: {
            tlo: 0,  // IMPORTANT: Always 0, must be measured on machine
            x: 0,
            y: 0,
            z: 0
          },
          metadata: {
            notes: tool.notes || '',
            image: '',
            sku: tool.sku || ''
          }
        };
        
        convertedTools.push(ncSenderTool);
      } catch (error) {
        skippedTools.push(`Tool "${tool.name}": ${error.message}`);
      }
    }
    
    // 4. Report skipped tools
    if (skippedTools.length > 0) {
      console.log(`Skipped ${skippedTools.length} invalid tool(s)`);
      skippedTools.forEach(msg => console.log(`  - ${msg}`));
    }
    
    // 5. Ensure at least one valid tool
    if (convertedTools.length === 0) {
      throw new Error('No valid tools found in file');
    }
    
    return convertedTools;
  } catch (error) {
    // Provide user-friendly error messages
    throw new Error(`Failed to import: ${error.message}`);
  }
}

/**
 * Helper: Map external tool type to ncSender type
 */
function mapToolType(externalType) {
  const typeMap = {
    'endmill': 'flat',
    'ballnose': 'ball',
    'chamfer': 'v-bit',
    // ... more mappings
  };
  return typeMap[externalType?.toLowerCase()] || 'flat';
}

/**
 * Helper: Convert units to millimeters
 */
function convertToMm(value, units) {
  if (units === 'inches') {
    return value * 25.4;
  }
  return value; // Already in mm
}

/**
 * Plugin entry point
 */
export function onLoad(ctx) {
  ctx.log('My Tool Importer plugin loaded');
  
  // Register the tool importer
  ctx.registerToolImporter(
    'MyCAM (JSON)',           // Display name in UI
    ['.json', '.mycam'],      // Supported file extensions
    importMyTools             // Handler function
  );
}

export function onUnload() {
  // Cleanup if needed
}
```

## API Reference

### ctx.registerToolImporter(name, fileExtensions, handler)

Registers a tool importer that appears in the Tools tab Import menu.

**Parameters:**
- `name` (string) - Display name shown in the import dropdown (e.g., "Fusion 360 (JSON)")
- `fileExtensions` (string|Array) - File extensions to accept (e.g., `['.json', '.csv']`)
- `handler` (function) - Async function that converts file content to ncSender tools

**Handler Signature:**
```javascript
async function handler(fileContent, fileName) {
  // fileContent: string - Raw file content
  // fileName: string - Original filename with extension
  // Returns: Array of ncSender tool objects
  // Throws: Error with user-friendly message
}
```

## Complete Example: Fusion 360 Importer

See the reference implementation at:
```
samples/com.ncsender.fusion360-import/
├── index.js
└── manifest.json
```

Key features demonstrated:
- **Stable ID mapping**: Fusion tool number → ncSender ID (prevents duplicates)
- **ATC slot mapping**: Fusion turret → ncSender toolNumber
- Type mapping from Fusion 360 to ncSender types
- Setting TLO to 0 (not importing from `assemblyGaugeLength`)
- Handling unassigned tools (turret = 0 → toolNumber = null)
- Unit conversion (if needed)
- Validation and error handling
- Skipping invalid tools with logging
- Generating fallback descriptions for tools with empty names
- Optional configuration UI for including tool numbers in descriptions

### Fusion 360 Field Mappings

When importing from Fusion 360, use these field mappings:

| Fusion 360 Field | ncSender Field | Notes |
|-----------------|----------------|-------|
| `post-process.number` | `id` | **Fusion tool number becomes ID** (prevents duplicates) |
| `post-process.turret` | `toolNumber` | ATC slot: 0 → null, 1+ → use as-is |
| `geometry.DC` | `diameter` | Cutting diameter (already in mm) |
| `type` | `type` | Requires mapping (see table below) |
| `description` | `name` | Generate fallback if empty, optionally prefix with tool number |
| `geometry.assemblyGaugeLength` | ❌ DO NOT USE | Always set `offsets.tlo: 0` |

**Fusion 360 Type Mapping:**

| Fusion 360 Type | ncSender Type |
|----------------|---------------|
| `flat end mill` | `flat` |
| `ball end mill` | `ball` |
| `chamfer mill` | `v-bit` |
| `face mill` | `surfacing` |
| `thread mill` | `thread-mill` |
| Other | `flat` (default) |

**Important Notes:**
- **Fusion tool number (`post-process.number`) becomes ncSender ID** - this prevents duplicates when re-importing
- Fusion 360's `turret` field: 0 = unassigned, 1+ = ATC slot number
- ncSender's `toolNumber`: null = unassigned, 1+ = ATC slot number
- Map Fusion turret 0 → ncSender null, otherwise use value directly
- Never import `assemblyGaugeLength` as TLO - it's for CAM simulation only
- Re-importing the same library will prompt to replace existing tools (by ID match)

## Best Practices

### 1. Robust Error Handling

```javascript
// ✅ Good: Provide context in errors
if (!data.tools) {
  throw new Error('Invalid format. Expected "tools" array.');
}

// ❌ Bad: Generic errors
if (!data.tools) {
  throw new Error('Invalid file');
}
```

### 2. Validate Required Fields

```javascript
// Validate diameter
if (!tool.diameter || tool.diameter <= 0) {
  skippedTools.push(`Tool "${tool.name}" has invalid diameter: ${tool.diameter}`);
  continue;
}

// Validate name
if (!tool.name || tool.name.trim() === '') {
  skippedTools.push('Tool missing name field');
  continue;
}
```

### 3. Skip Invalid Tools, Don't Fail

```javascript
// ✅ Good: Skip individual bad tools, continue processing
for (const tool of tools) {
  try {
    const converted = convertTool(tool);
    convertedTools.push(converted);
  } catch (error) {
    skippedTools.push(`${tool.name}: ${error.message}`);
  }
}

// ❌ Bad: Fail entire import on first error
for (const tool of tools) {
  const converted = convertTool(tool); // Unhandled exception stops import
  convertedTools.push(converted);
}
```

### 4. Provide Import Summary

```javascript
if (skippedTools.length > 0) {
  ctx.log(`Skipped ${skippedTools.length} invalid tool(s):`);
  skippedTools.forEach(msg => ctx.log(`  - ${msg}`));
}

ctx.log(`Successfully converted ${convertedTools.length} tool(s)`);
```

### 5. Handle Different Units

```javascript
function convertToMm(value, units) {
  if (!value || value === 0) return 0;
  
  switch (units?.toLowerCase()) {
    case 'inches':
    case 'in':
      return value * 25.4;
    case 'mm':
    case 'millimeters':
    default:
      return value;
  }
}
```

### 6. Use High Temporary IDs

```javascript
// ✅ Good: High IDs won't conflict with existing tools
let tempIdCounter = 100000;
tool.id = tempIdCounter++;

// ❌ Bad: Low IDs may conflict
tool.id = index; // Could overwrite existing tools
```

### 7. Use Stable IDs from Source System

```javascript
// ✅ Good: Use source system's tool identifier as ID
const toolId = sourceTool.toolNumber || sourceTool.id;
if (!toolId) {
  throw new Error('Tool missing identifier');
}

const ncSenderTool = {
  id: toolId,  // Stable ID prevents duplicates on re-import
  toolNumber: sourceTool.atcSlot || null,  // Physical ATC slot
  // ... other fields
};

// ❌ Bad: Random or sequential IDs create duplicates
tool.id = Math.random() * 1000000;  // Different every import!
tool.id = index;  // Changes if tool order changes!
```

### 8. Provide Fallback Values

```javascript
// Generate description if missing
let description = tool.description || '';
if (!description.trim()) {
  description = `${tool.type || 'Tool'} - ${tool.diameter}mm`;
}

// Default tool type
const type = mapToolType(tool.type) || 'flat';

// Default ATC slot (map from turret/slot/pocket field, not tool ID)
const toolNumber = (tool.slot && tool.slot > 0) ? tool.slot : null;

// IMPORTANT: Always set TLO to 0
const tlo = 0; // Must be measured on the machine, not imported
```

## Testing Your Importer

1. **Install the plugin** in the ncSender plugins directory
2. **Restart ncSender** to load the plugin
3. **Check the console** for registration messages
4. **Open Tools tab** and verify your importer appears in the Import dropdown
5. **Test with valid files** and verify tools import correctly
6. **Test with invalid files** and verify error handling
7. **Check unit conversion** if applicable
8. **Verify tool type mapping** is correct

### Common Issues

**Importer doesn't appear in menu:**
- Check plugin is in correct directory
- Verify manifest.json is valid
- Restart ncSender
- Check console for loading errors

**Import fails silently:**
- Check handler throws errors (not just returns empty array)
- Verify error messages are descriptive
- Check browser console for JavaScript errors

**Tools appear with wrong values:**
- Verify unit conversion (inches → mm)
- Check diameter is in millimeters
- Ensure TLO is set to 0 (not imported from CAM software)
- Verify `toolNumber` maps to ATC slot (turret/pocket), NOT tool identifier
- Don't confuse CAM tool numbers with ATC slot numbers

## Adding Configuration UI (Optional)

If your importer needs user configuration (e.g., unit preferences, naming conventions), you can add a configuration UI:

```javascript
export function onLoad(ctx) {
  // Register importer
  ctx.registerToolImporter('MyCAM', ['.json'], importMyTools);
  
  // Register configuration UI
  const configUI = `
    <div style="padding: 16px;">
      <h3>Import Settings</h3>
      <label>
        <input 
          type="checkbox" 
          id="includeToolNumbers"
          onchange="updateSetting('includeToolNumbers', this.checked)"
        >
        Include tool numbers in descriptions
      </label>
    </div>
    <script>
      async function updateSetting(key, value) {
        await fetch('/api/plugins/${ctx.pluginId}/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value })
        });
      }
    </script>
  `;
  
  ctx.registerConfigUI(configUI);
}
```

Then access settings in your handler:

```javascript
async function importMyTools(fileContent, fileName) {
  const settings = pluginContext.getSettings() || {};
  const includeNumbers = settings.includeToolNumbers || false;
  
  // Use settings during conversion...
}
```

## Related Documentation

- **PLUGIN_DEVELOPMENT.md** - General plugin development guide
- **PLUGIN_ARCHITECTURE.md** - Plugin system architecture
- **samples/com.ncsender.fusion360-import/** - Reference implementation

## Support

If you encounter issues or have questions:
- Check the ncSender console for error messages
- Review the Fusion 360 importer example
- Refer to the plugin development documentation
- Report bugs or request features on GitHub

