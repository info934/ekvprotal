import React, { useEffect, useMemo, useState } from 'react';
import { PackagePlus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const productKey = (product) => product.id || product.code || product.sku || product.name;

const compactSearchValue = (value) => String(value || '').toLowerCase();

const metadataSearchValues = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return [];
  return Object.values(metadata)
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') return Object.values(value);
      return value;
    })
    .filter(Boolean);
};

const inferBrandFromText = (text) => {
  const value = compactSearchValue(text);
  const brands = [
    ['SolaX', ['solax', 'x1-', 'x3-', 't-bat', 'aelio', 'trene']],
    ['Huawei', ['huawei', 'sun2000', 'luna2000']],
    ['GoodWe', ['goodwe']],
    ['SolarEdge', ['solaredge']],
    ['Fronius', ['fronius']],
    ['Growatt', ['growatt']],
    ['SMA', ['sma sunny', 'sunny boy', 'sunny tripower']],
    ['Trina', ['trina']],
    ['AIKO', ['aiko']],
    ['JA Solar', ['ja solar', 'jasolar']],
    ['Tigo', ['tigo']],
  ];
  return brands.find(([, needles]) => needles.some((needle) => value.includes(needle)))?.[0] || '';
};

const getProductBrand = (product) => {
  const metadata = product?.metadata || {};
  return (
    metadata.brand ||
    metadata.manufacturer ||
    metadata.vendor ||
    inferBrandFromText([product?.name, product?.description, product?.sku, product?.code, metadata.supplier_category].filter(Boolean).join(' '))
  );
};

const uniqueSortedValues = (products, getter) => (
  Array.from(new Set(products.map(getter).filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'cs'))
);

const CrmProductPickerDialog = ({
  open,
  onOpenChange,
  products = [],
  loading = false,
  onApply,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [brand, setBrand] = useState('all');
  const [productType, setProductType] = useState('all');
  const [status, setStatus] = useState('active');
  const [selectedKeys, setSelectedKeys] = useState({});

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedKeys({});
    }
  }, [open]);

  const categories = useMemo(() => uniqueSortedValues(products, (product) => product.category), [products]);
  const brands = useMemo(() => uniqueSortedValues(products, getProductBrand), [products]);
  const productTypes = useMemo(() => uniqueSortedValues(products, (product) => product.product_type), [products]);

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const isArchived = product.is_active === false;
      const productBrand = getProductBrand(product);
      if (status === 'active' && isArchived) return false;
      if (status === 'archived' && !isArchived) return false;
      if (category !== 'all' && product.category !== category) return false;
      if (brand !== 'all' && productBrand !== brand) return false;
      if (productType !== 'all' && product.product_type !== productType) return false;
      if (!needle) return true;
      return [
        product.code,
        product.sku,
        product.name,
        product.description,
        product.category,
        product.product_type,
        productBrand,
        product.supplier_name,
        product.supplier_sku,
        product.preferred_supplier_offer_id,
        ...metadataSearchValues(product.metadata),
      ]
        .filter(Boolean)
        .some((value) => compactSearchValue(value).includes(needle));
    });
  }, [brand, category, productType, products, query, status]);

  const selectedProducts = useMemo(() => (
    products.filter((product) => selectedKeys[productKey(product)])
  ), [products, selectedKeys]);

  const toggleProduct = (product, checked) => {
    const key = productKey(product);
    setSelectedKeys((current) => {
      const next = { ...current };
      if (checked) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  const handleApply = () => {
    onApply?.(selectedProducts);
    setSelectedKeys({});
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <PackagePlus className="h-4 w-4 text-primary" />
            Produktovy katalog
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 p-4">
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_160px_160px_180px_140px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Hledat kod, nazev, znacku, SKU dodavatele..."
                className="h-9 pl-9 text-sm"
              />
            </div>
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Znacka" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsechny znacky</SelectItem>
                {brands.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Kategorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsechny kategorie</SelectItem>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={productType} onValueChange={setProductType}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Produktova rada" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsechny rady</SelectItem>
                {productTypes.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Stav" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktivni</SelectItem>
                <SelectItem value="archived">Archivovane</SelectItem>
                <SelectItem value="all">Vse</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-md border bg-white">
            <div className="max-h-[48vh] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50">
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="min-w-[120px]">Kod</TableHead>
                    <TableHead className="min-w-[280px]">Nazev produktu</TableHead>
                    <TableHead className="min-w-[130px] text-right">Prodej</TableHead>
                    <TableHead className="min-w-[120px] text-right">Nakup</TableHead>
                    <TableHead className="min-w-[90px] text-right">DPH</TableHead>
                    <TableHead className="min-w-[170px]">Kategorie / rada</TableHead>
                    <TableHead className="min-w-[260px]">Popis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Nacitam katalog...</TableCell>
                    </TableRow>
                  ) : filteredProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Zadny produkt neodpovida filtru.</TableCell>
                    </TableRow>
                  ) : filteredProducts.map((product) => {
                    const key = productKey(product);
                    const checked = Boolean(selectedKeys[key]);
                    const productBrand = getProductBrand(product);
                    return (
                      <TableRow key={key} className="cursor-pointer hover:bg-blue-50/40" onClick={() => toggleProduct(product, !checked)}>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox checked={checked} onCheckedChange={(value) => toggleProduct(product, Boolean(value))} />
                        </TableCell>
                        <TableCell className="font-medium text-slate-800">{product.code || product.sku || '-'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2 font-medium text-slate-950">
                            <span>{product.name || 'Produkt bez nazvu'}</span>
                            {productBrand && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{productBrand}</Badge>}
                          </div>
                          {product.sku && <div className="text-xs text-muted-foreground">{product.sku}</div>}
                        </TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(product.default_unit_price)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(product.purchase_price)}</TableCell>
                        <TableCell className="text-right">{Number(product.default_vat_rate ?? 21)} %</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {product.category && <Badge variant="secondary">{product.category}</Badge>}
                            {product.product_type && <Badge variant="outline">{product.product_type}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[320px] truncate text-muted-foreground">{product.description || '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="rounded-md border bg-slate-50 p-3">
            <Label className="text-xs uppercase tracking-wide text-slate-500">Vybrane produkty</Label>
            {selectedProducts.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Zatim neni vybran zadny produkt.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedProducts.map((product) => (
                  <Badge key={productKey(product)} variant="secondary" className="gap-1">
                    {product.code || product.sku || '-'} - {product.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t bg-slate-50 px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>Zrusit</Button>
          <Button type="button" onClick={handleApply} disabled={selectedProducts.length === 0}>
            Vlozit vybrane ({selectedProducts.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CrmProductPickerDialog;
