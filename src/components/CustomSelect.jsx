import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable Custom Select Component
 * Features: Searchable, Custom Styling, Keyboard Navigation, Animations
 */
const CustomSelect = ({
  items = [],
  value,
  onChange,
  placeholder = "Vybrat...",
  searchPlaceholder = "Hledat...",
  disabled = false,
  loading = false,
  error = null,
  themeColor = "blue", // "blue" | "amber" | "gray"
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);

  // Theme configuration
  const themes = {
    blue: {
      ring: "focus:ring-blue-500",
      selectedBg: "bg-blue-100",
      selectedText: "text-blue-900",
      hoverBg: "hover:bg-blue-50",
      iconColor: "text-blue-600",
    },
    amber: {
      ring: "focus:ring-amber-500",
      selectedBg: "bg-amber-100",
      selectedText: "text-amber-900",
      hoverBg: "hover:bg-amber-50",
      iconColor: "text-amber-600",
    },
    gray: {
      ring: "focus:ring-gray-500",
      selectedBg: "bg-gray-100",
      selectedText: "text-gray-900",
      hoverBg: "hover:bg-gray-50",
      iconColor: "text-gray-600",
    }
  };

  const currentTheme = themes[themeColor] || themes.blue;

  // Filter items
  const filteredItems = items.filter(item => 
    item.label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Selected Item Display
  const selectedItem = items.find(item => item.id === value);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm(""); // Reset search on close
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current && listRef.current.children[highlightedIndex]) {
      listRef.current.children[highlightedIndex].scrollIntoView({
        block: 'nearest',
      });
    }
  }, [highlightedIndex, isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < filteredItems.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
        break;
      case "Enter":
        e.preventDefault();
        if (filteredItems[highlightedIndex]) {
          handleSelect(filteredItems[highlightedIndex].id);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setSearchTerm("");
        break;
      case "Tab":
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  const handleSelect = (id) => {
    onChange(id);
    setIsOpen(false);
    setSearchTerm("");
  };

  const toggleOpen = () => {
    if (disabled || loading) return;
    setIsOpen(!isOpen);
    if (!isOpen) {
        setSearchTerm("");
        setHighlightedIndex(0);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className={cn("relative w-full text-sm", className)}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <div
        onClick={toggleOpen}
        className={cn(
          "flex items-center justify-between w-full px-3 py-2 text-left bg-white border rounded-md shadow-sm cursor-pointer transition-all duration-200",
          "hover:border-gray-400 hover:shadow-md",
          isOpen ? `ring-2 ${currentTheme.ring} border-transparent` : "border-input",
          disabled && "opacity-50 cursor-not-allowed bg-gray-50",
          error && "border-red-500 focus:ring-red-500 ring-1 ring-red-200"
        )}
        tabIndex={0}
      >
        <span className={cn("truncate", !selectedItem && "text-muted-foreground")}>
          {loading ? (
            <span className="flex items-center text-muted-foreground">
               <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Načítání...
            </span>
          ) : selectedItem ? (
            <span className="flex flex-col leading-tight">
               <span className="font-medium text-gray-900">{selectedItem.label}</span>
            </span>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown className={cn("w-4 h-4 ml-2 transition-transform duration-200 text-gray-400", isOpen && "transform rotate-180")} />
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-100 origin-top">
          
          {/* Search Input */}
          <div className="flex items-center px-3 py-2 border-b border-gray-100 bg-gray-50/50 rounded-t-lg">
            <Search className="w-4 h-4 text-gray-400 mr-2" />
            <input
              ref={searchInputRef}
              type="text"
              className="w-full bg-transparent border-none focus:outline-none text-sm text-gray-700 placeholder:text-gray-400"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setHighlightedIndex(0);
              }}
              onClick={(e) => e.stopPropagation()}
            />
            {searchTerm && (
                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        setSearchTerm("");
                        searchInputRef.current?.focus();
                    }}
                    className="text-gray-400 hover:text-gray-600"
                >
                    <X className="w-3 h-3"/>
                </button>
            )}
          </div>

          {/* Items List */}
          <ul 
            ref={listRef}
            className="max-h-60 overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent"
          >
            {filteredItems.length === 0 ? (
              <li className="px-4 py-3 text-center text-gray-500 italic">
                {searchTerm ? "Nenalezeno." : "Žádné položky."}
              </li>
            ) : (
              filteredItems.map((item, index) => {
                const isSelected = value === item.id;
                const isHighlighted = index === highlightedIndex;

                return (
                  <li
                    key={item.id}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(item.id);
                    }}
                    className={cn(
                      "px-4 py-2 cursor-pointer flex items-center justify-between transition-colors duration-150 group",
                      isSelected ? `${currentTheme.selectedBg}` : "",
                      isHighlighted && !isSelected ? `${currentTheme.hoverBg}` : "",
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <div className="flex flex-col overflow-hidden">
                      <span className={cn(
                        "font-medium truncate",
                        isSelected ? currentTheme.selectedText : "text-gray-700"
                      )}>
                        {item.label}
                      </span>
                      {item.description && (
                        <span className={cn(
                          "text-xs truncate",
                          isSelected ? "text-blue-700/70" : "text-gray-400 group-hover:text-gray-500"
                        )}>
                          {item.description}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <Check className={cn("w-4 h-4 ml-2", currentTheme.iconColor)} />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CustomSelect;