import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const ConfirmActionDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Potvrdit',
  cancelLabel = 'Zrušit',
  destructive = false,
  loading = false,
  onConfirm,
}) => (
  <AlertDialog open={open} onOpenChange={(nextOpen) => !loading && onOpenChange(nextOpen)}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
        <AlertDialogAction
          disabled={loading}
          onClick={(event) => {
            event.preventDefault();
            onConfirm();
          }}
          className={cn(destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
        >
          {loading ? 'Pracuji…' : confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default ConfirmActionDialog;
