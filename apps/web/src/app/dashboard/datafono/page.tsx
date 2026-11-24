import { redirect } from 'next/navigation';

// Los datáfonos y la página web ahora se ven juntos en "Mis ventas"; esta dirección se conserva para los enlaces que ya existían.
export default function DatafonoPage() {
  redirect('/dashboard/ventas');
}
