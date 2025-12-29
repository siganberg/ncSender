/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

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
  BITFIELD: 7,  // Bitfield (comma-separated bit names), MAC address (x(17)), or G-code string (x(127))
  STRING: 8,    // String value
  IPV4: 9       // IPv4 address
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
  [FIRMWARE_DATA_TYPES.IPV4]: 'ipv4'
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
 * Check if a data type is a bitfield type
 */
export function isBitfieldType(dataType) {
  return dataType === FIRMWARE_DATA_TYPES.BITFIELD;
}
