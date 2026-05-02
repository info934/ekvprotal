import React, { useState, useEffect } from "react";
import { Check, ChevronsUpDown, Plus, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/lib/customSupabaseClient";
import { useToast } from "@/components/ui/use-toast";

// Fixed version of MemberCombobox for backward compatibility or other uses
const MemberCombobox = ({
  value,
  onChange,
  placeholder = "Vybrat člena...",
  disabled = false,
  onCreateNew,
  excludeIds = [],
}) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { toast } = useToast();

  const fetchMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      // console.log("MemberCombobox: Fetching members...");
      const { data, error } = await supabase
        .from('members')
        .select('id, name, email, phone')
        .order('name');

      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      console.error("MemberCombobox: Error fetching members:", err);
      setError("Nepodařilo se načíst seznam.");
      toast({
        title: "Chyba načítání",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const selectedItem = items.find((item) => item.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between",
            !value && "text-muted-foreground",
            disabled && "opacity-50 cursor-not-allowed",
            error && "border-red-500"
          )}
          disabled={disabled || loading}
          type="button" // Important to prevent form submission
        >
          {loading ? (
             <span className="flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Načítání...</span>
          ) : selectedItem ? (
            selectedItem.name
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Hledat člena..." />
          <CommandEmpty>
            <p className="py-2 text-sm text-center text-muted-foreground">
              Nenalezeno.
            </p>
            {onCreateNew && (
              <div className="p-2 flex justify-center border-t mt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full h-8"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    onCreateNew();
                  }}
                  type="button"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Vytvořit nového člena
                </Button>
              </div>
            )}
          </CommandEmpty>
          <CommandGroup className="max-h-64 overflow-y-auto">
            {items
              .filter(item => !excludeIds.includes(item.id))
              .map((item) => (
              <CommandItem
                key={item.id}
                value={item.name}
                onSelect={() => {
                  onChange(item.id === value ? "" : item.id);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === item.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <div className="flex flex-col">
                  <span>{item.name}</span>
                  {(item.email || item.phone) && (
                    <span className="text-xs text-muted-foreground">
                      {item.email}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default MemberCombobox;