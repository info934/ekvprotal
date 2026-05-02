import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from 'lucide-react';

const CancelPayoutRequestDialog = ({ isOpen, onClose, onConfirm, isDeleting }) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-red-600">Zrušit žádost</AlertDialogTitle>
          <AlertDialogDescription>
            Opravdu chceš zrušit tuto žádost? Tato akce je nevratná.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Storno</AlertDialogCancel>
          <AlertDialogAction 
            onClick={(e) => { e.preventDefault(); onConfirm(); }} 
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600 text-white" 
            disabled={isDeleting}
          >
            {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Zrušit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CancelPayoutRequestDialog;