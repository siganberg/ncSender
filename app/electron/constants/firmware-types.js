/**
 * grblHAL Firmware Data Type Mappings
 *
 * These data types are returned in the $ES (enumerate settings) response
 * in the format: [SETTING:<id>|<group id>|<name>|{<unit>}|<data type>|{<format>}|{<min>}|{<max>}]
 */

export const FIRMWARE_DATA_TYPES = {
  INT8: 0,      // Signed 8-bit integer
  UINT8: 1,     // Unsigned 8-bit integer
  INT16: 2,     // Signed 16-bit integer
  UINT16: 3,    // Unsigned 16-bit integer
  INT32: 4,     // Signed 32-bit integer
  UINT32: 5,    // Unsigned 32-bit integer
  FLOAT: 6,     // Floating point number
  BITFIELD: 7,  // Bitfield (comma-separated bit names in format field)
  STRING: 8,    // String value
  MASK: 9       // Bitmask (multi-option selection)
};

export const DATA_TYPE_NAMES = {
  [FIRMWARE_DATA_TYPES.INT8]: 'int8',
  [FIRMWARE_DATA_TYPES.UINT8]: 'uint8',
  [FIRMWARE_DATA_TYPES.INT16]: 'int16',
  [FIRMWARE_DATA_TYPES.UINT16]: 'uint16',
  [FIRMWARE_DATA_TYPES.INT32]: 'int32',
  [FIRMWARE_DATA_TYPES.UINT32]: 'uint32',
  [FIRMWARE_DATA_TYPES.FLOAT]: 'float',
  [FIRMWARE_DATA_TYPES.BITFIELD]: 'bitfield',
  [FIRMWARE_DATA_TYPES.STRING]: 'string',
  [FIRMWARE_DATA_TYPES.MASK]: 'mask'
};

/**
 * Check if a data type is an integer type
 */
export function isIntegerType(dataType) {
  return [
    FIRMWARE_DATA_TYPES.INT8,
    FIRMWARE_DATA_TYPES.UINT8,
    FIRMWARE_DATA_TYPES.INT16,
    FIRMWARE_DATA_TYPES.UINT16,
    FIRMWARE_DATA_TYPES.INT32,
    FIRMWARE_DATA_TYPES.UINT32
  ].includes(dataType);
}

/**
 * Check if a data type is a numeric type (integer or float)
 */
export function isNumericType(dataType) {
  return isIntegerType(dataType) || dataType === FIRMWARE_DATA_TYPES.FLOAT;
}

/**
 * Check if a data type is a bitfield or mask type
 */
export function isBitfieldType(dataType) {
  return dataType === FIRMWARE_DATA_TYPES.BITFIELD || dataType === FIRMWARE_DATA_TYPES.MASK;
}
