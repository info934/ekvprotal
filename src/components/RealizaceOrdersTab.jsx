import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialValueGuard from './FinancialValueGuard';

const statusConfig = {
  'nová': { label: 'Nová', variant: 'secondary' },
  'odeslána': { label: 'Odeslána', variant: 'info' },
  'přijata': { label: 'Přijata', variant: 'success' },
  'zrušena': { label: 'Zrušena', variant: 'destructive' },
};

const commercialStatusConfig = {
  offer: { label: 'Nabídka', variant: 'outline' },
  order: { label: 'Objednávka', variant: 'secondary' },
  offer_accepted: { label: 'Nabídka přijata', variant: 'success' },
  cancelled: { label: 'Zrušeno', variant: 'destructive' },
};

const RealizaceOrdersTab = ({ realizaceId, onOrdersChanged }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasPermission, userRole } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const { canViewAmounts } = getFinancialVisibility(userRole);
  const canEdit = hasPermission('realizace', 'can_edit') && userRole !== 'user';

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('realizace_orders')
      .select('*, supplier:supplier_id(name)')
      .eq('realizace_id', realizaceId)
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Chyba při načítání objednávek', variant: 'destructive', description: error.message });
    } else {
      setOrders(data || []);
      if (onOrdersChanged) {
        const total = (data || []).reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);
        onOrdersChanged(total);
      }
    }
    setLoading(false);
  }, [realizaceId, toast, onOrdersChanged]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleDeleteOrder = async (orderId) => {
    const { error } = await supabase.from('realizace_orders').delete().eq('id', orderId);
    if (error) {
      toast({ title: 'Chyba při mazání objednávky', variant: 'destructive', description: error.message });
    } else {
      toast({ title: 'Objednávka smazána' });
      fetchOrders();
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Objednávky materiálu a služeb</CardTitle>

        </div>
        {canEdit && (
          <Button onClick={() => navigate(`/realizace/${realizaceId}/orders/new`)}>
            <Plus className="mr-2 h-4 w-4" /> Nová nabídka / objednávka
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center">Načítání objednávek...</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Číslo obj.</TableHead>
                  <TableHead>Dodavatel</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead>Položky</TableHead>
                  {canViewAmounts && <TableHead className="text-right">Částka</TableHead>}
                  <TableHead className="text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canViewAmounts ? 8 : 7} className="h-24 text-center">
                      Nebyly nalezeny žádné objednávky.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => {
                    const status = statusConfig[order.status] || { label: order.status, variant: 'default' };
                    const commercialStatus = commercialStatusConfig[order.commercial_status || 'order'] || commercialStatusConfig.order;
                    const itemCount = Array.isArray(order.items) ? order.items.length : 0;
                    const orderLabel = order.order_number || order.id;

                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.order_number}</TableCell>
                        <TableCell>{order.supplier?.name || 'N/A'}</TableCell>
                        <TableCell>{format(new Date(order.created_at), 'd.M.yyyy')}</TableCell>
                        <TableCell><Badge variant={commercialStatus.variant}>{commercialStatus.label}</Badge></TableCell>
                        <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                        <TableCell>{itemCount}</TableCell>
                        {canViewAmounts && (
                          <TableCell className="text-right font-semibold">
                            <FinancialValueGuard value={`${(order.total_amount || 0).toLocaleString('cs-CZ')} Kč`} />
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {canEdit && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Upravit objednávku ${orderLabel}`}
                                  onClick={() => navigate(`/realizace/${realizaceId}/orders/${order.id}/edit`)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" aria-label={`Smazat objednávku ${orderLabel}`}>
                                      <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Opravdu smazat objednávku?</AlertDialogTitle>
                                      <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteOrder(order.id)} className="bg-red-600 hover:bg-red-700">
                                        Smazat
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RealizaceOrdersTab;
