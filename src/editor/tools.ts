export type Tool = 'select' | 'outline' | 'circle-hole' | 'polygon-hole';

export const TOOLS: readonly { id: Tool; label: string; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    hint: 'Click an edge to set supports and loads. Drag corners or hole centres to move them. Double-click an edge to add a corner.',
  },
  {
    id: 'outline',
    label: 'Outline',
    hint: 'Click to place corners. Click the first corner or press Enter to close. Esc cancels, Backspace removes the last corner.',
  },
  { id: 'circle-hole', label: 'Circle hole', hint: 'Press at the centre and drag out the radius.' },
  {
    id: 'polygon-hole',
    label: 'Polygon hole',
    hint: 'Click to place corners. Click the first corner or press Enter to close.',
  },
];

export function toolHint(tool: Tool): string {
  return TOOLS.find((t) => t.id === tool)?.hint ?? '';
}
