# Claude Development Preferences

This file contains development preferences and patterns to follow when working on the ncSender project.

## Architecture Patterns

### Vertical/Feature Architecture
- **Preference**: Follow vertical/feature architecture patterns by organizing code into feature-based modules with clear separation of concerns
- **Avoid**: Horizontal/layer-based organization that spreads feature logic across multiple files
- **Implementation**: Each feature area should have its own module that can be developed and tested independently
- **Example**: The server.js refactoring that separated routes into feature-based modules:
  - `cnc-routes.js` - CNC connection and control
  - `command-history-routes.js` - Command history management
  - `gcode-routes.js` - G-code file operations
  - `settings-routes.js` - Settings management
  - `system-routes.js` - Health and server state

### API Routes Organization
- **Rule**: Each resource should have its own dedicated route file
- **Pattern**: One route file per REST resource (e.g., `/api/settings`, `/api/gcode-files`, `/api/firmware`)
- **File naming**: Use `{resource-name}-routes.js` format
- **Location**: All route files in `app/electron/routes/`
- **Benefits**: Clear separation of concerns, easier maintenance, independent testing

## Naming Conventions

### JavaScript/Node.js Files
- **File names**: Use kebab-case (e.g., `cnc-controller.js`, `gcode-visualizer.js`)
- **Avoid**: PascalCase for file names (e.g., `CNCController.js`, `GCodeVisualizer.js`)
- **Rationale**: Follows Node.js community standards and prevents case-sensitivity issues

## Code Quality

### Comments
- **Preference**: Avoid adding comments unless explicitly requested
- **Focus**: Write self-documenting code with clear naming and structure

### Defensive Programming
- **Avoid**: Excessive parameter validation and defensive checks in constructors and internal functions
- **Rationale**: Only validate input from users or external source, not developer stupidity. JavaScript will naturally throw errors when accessing undefined/null, which is sufficient for debugging
- **Don't**: Add checks like `if (!dependency) throw new Error('dependency required')`
- **Do**: Trust that internal dependencies are passed correctly and let natural errors surface during development

### Console Logging
- **Browser logs**: Always use JSON.stringify() for objects to enable easy copy/paste
- **Format**: `console.log('Message:', JSON.stringify(data))`
- **Avoid**: Logging plain objects that can't be copied from the console

### Security
- **Critical**: Never introduce code that exposes or logs secrets and keys
- **Required**: Always follow security best practices
- **Prohibited**: Never commit secrets or keys to the repository

## Git Commit Preferences

### Commit Messages
- **Required**: Use clean, descriptive commit messages without attribution or metadata
- **Avoid**: Adding "🤖 Generated with [Claude Code]" or "Co-Authored-By: Claude" lines
- **Format**: Use standard git commit format with summary line and bullet points for details
- **Focus**: Describe what was changed and why, not who made the change

## Git Release

### Creating Releases
- **IMPORTANT**: Always use the release script: `./.scripts/release.sh`
- **Never**: Manually bump versions, create tags, or push releases
- The release script handles everything: version bump, commit, tag, push, and triggers CI/CD

### Release Notes
- When asked to create a git release note, start from the last tag to the head.
- If latest tag is on the same head, use the prior tag.
- Always make the release note, focus on users not developers.
- Add emoji on the categories.
- Output a copy/paste format.