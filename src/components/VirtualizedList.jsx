import React, { useRef, useEffect } from 'react';
import { FixedSizeList, VariableSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { cn } from '@/lib/utils';

/**
 * VirtualizedList component for efficiently rendering large lists.
 * Uses react-window for virtualization and react-virtualized-auto-sizer for responsiveness.
 * 
 * @param {Object} props
 * @param {Array} props.items - Array of items to render
 * @param {number|Function} props.itemHeight - Row height (number for fixed, function(index) for variable)
 * @param {Function} props.renderItem - Render function ({ index, style, item })
 * @param {string} [props.className] - CSS class for the list container
 * @param {number} [props.overscan=5] - Number of items to render outside the visible area
 * @param {number|string} [props.width] - Explicit width (optional, otherwise AutoSizer is used)
 * @param {number|string} [props.height] - Explicit height (optional, otherwise AutoSizer is used)
 */
const VirtualizedList = ({ 
  items, 
  itemHeight, 
  renderItem, 
  className,
  overscan = 5,
  width,
  height
}) => {
  const listRef = useRef(null);
  const isVariable = typeof itemHeight === 'function';
  const ListComponent = isVariable ? VariableSizeList : FixedSizeList;

  // Reset cache if items change (for VariableSizeList) to ensure correct heights are recalculated
  useEffect(() => {
    if (isVariable && listRef.current) {
      listRef.current.resetAfterIndex(0);
    }
  }, [items, isVariable]);

  const Row = ({ index, style, data }) => {
    const item = data[index];
    return renderItem({ index, style, item });
  };

  const renderList = ({ width: w, height: h }) => (
    <ListComponent
      ref={listRef}
      height={h}
      width={w}
      itemCount={items.length}
      itemSize={itemHeight}
      itemData={items}
      overscanCount={overscan}
      className={cn("scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent", className)}
    >
      {Row}
    </ListComponent>
  );

  // If explicit dimensions are provided, render directly without AutoSizer
  if (width && height) {
    return renderList({ width, height });
  }

  // Otherwise use AutoSizer to fill the parent container
  return (
    <div style={{ flex: '1 1 auto', height: '100%', width: '100%', minHeight: 0 }}>
      <AutoSizer>
        {({ width: autoWidth, height: autoHeight }) => renderList({ width: autoWidth, height: autoHeight })}
      </AutoSizer>
    </div>
  );
};

export default VirtualizedList;