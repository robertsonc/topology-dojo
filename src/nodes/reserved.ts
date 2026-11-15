/**
 * Names a custom node type may not take: every built-in engine type and
 * every stock (shipped) type. Registering a custom type under one of them
 * would replace that type's art. The Node Designer refuses these names in
 * the UI (`ui/custom-type-name.ts`); parseDoc, validateDocument and the
 * builder's defineNodeType refuse them for every other way a spec arrives.
 */
import { isBuiltinNodeType } from '../api/builtins.js';
import { isStockNodeType } from './stock.js';

export function isReservedNodeTypeName(name: string): boolean {
  return isBuiltinNodeType(name) || isStockNodeType(name);
}
