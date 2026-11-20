import axios, { AxiosInstance, AxiosError } from 'axios';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let isRefreshing = false;
let failedQueue: Array<{ resolve: Function; reject: Function }> = [];

function processQueue(error: any, token: string | null = null) {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token));
  failedQueue = [];
}

export const api: AxiosInstance = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // send cookies
});

// ── Attach token ──
api.interceptors.request.use(config => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Auto refresh on 401 ──
api.interceptors.response.use(
  response => response,
  async (error: AxiosError) => {
    const original = error.config as any;
    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }
      original._retry = true;
      isRefreshing = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken }, { withCredentials: true });
        const { accessToken, refreshToken: newRT } = data;
        localStorage.setItem('accessToken', accessToken);
        if (newRT) localStorage.setItem('refreshToken', newRT);
        processQueue(null, accessToken);
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (err) {
        processQueue(err, null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        throw err;
      } finally {
        isRefreshing = false;
      }
    }
    throw error;
  }
);

// ── Typed API calls ──
export const authApi = {
  login:      (data: { cedula: string; pin: string }) => api.post('/auth/login', data),
  verifyLogin2fa: (data: { cedula: string; otp: string }) => api.post('/auth/login/verify-2fa', data),
  register:   (data: any) => api.post('/auth/register', data),
  logout:     () => api.post('/auth/logout'),
  me:         () => api.get('/auth/me'),
  changePin:  (data: any) => api.put('/auth/change-pin', data),
  verifyPin:  (pin: string) => api.post('/auth/verify-pin', { pin }),
  sessions:            () => api.get('/auth/sessions'),
  revokeSession:       (id: string) => api.delete(`/auth/sessions/${id}`),
  revokeOtherSessions: () => api.post('/auth/sessions/revoke-others'),
};

export const usersApi = {
  updateProfile: (data: any) => api.put('/users/profile', data),
};

export const bankAccountsApi = {
  list:   () => api.get('/bank-accounts'),
  create: (data: any) => api.post('/bank-accounts', data),
  remove: (id: string) => api.delete(`/bank-accounts/${id}`),
};

export const walletApi = {
  balance:    () => api.get('/wallet/balance'),
  saldoMensual: (meses = 6) => api.get('/wallet/saldo-mensual', { params: { meses } }),
  comision:   () => api.get('/wallet/comision'),
  history:    (params?: any) => api.get('/wallet/history', { params }),
  send:       (data: any) => api.post('/wallet/enviar', data),
  qrGenerar:  (data: any) => api.post('/wallet/qr/generar', data),
  qrPersonal: () => api.get('/wallet/qr/personal'),
  qrPreview:  (token: string) => api.get(`/wallet/qr/${token}`),
  qrPagar:    (token: string, data?: any) => api.post(`/wallet/qr/${token}/pagar`, data || {}),
};

export const banksApi = {
  list: () => api.get('/banks'),
};

export const withdrawalsApi = {
  create:  (data: any) => api.post('/withdrawals', data),
  history: () => api.get('/withdrawals/me'),
};

export const kushkiApi = {
  consignarTarjeta: (token: string, monto: number) => api.post('/kushki/consignar/tarjeta', { token, monto }),
  iniciarPSE: (data: { token: string; monto: number; documentType: string; documentNumber: string; email: string; nombreCompleto: string; telefono?: string }) =>
    api.post('/kushki/consignar/pse/iniciar', data),
  confirmarPSE: (token: string) => api.post('/kushki/consignar/pse/confirmar', { token }),
  metodos: () => api.get('/kushki/metodos'),
  iniciarBreB: (monto: number) => api.post('/kushki/consignar/breb/iniciar', { monto }),
  cancelarBreB: (token: string) => api.post('/kushki/consignar/breb/cancelar', { token }),
  consignaciones: () => api.get('/kushki/consignaciones'),
};

// Cobros con datáfono (Kushki One): la cuenta elige un terminal y un monto; el resultado se consulta hasta que termina
export const datafonosApi = {
  terminales: () => api.get('/datafonos/terminales'),
  cobrar:     (terminalId: string, monto: number) => api.post('/datafonos/cobros', { terminalId, monto }),
  cobro:      (id: string) => api.get(`/datafonos/cobros/${id}`),
  cobros:     () => api.get('/datafonos/cobros'),
  resumen:    (periodo: string) => api.get('/datafonos/resumen', { params: { periodo } }),
  reembolsar: (id: string) => api.post(`/datafonos/cobros/${id}/reembolsar`),
  admin: {
    resumen:       (periodo: string) => api.get('/datafonos/admin/resumen', { params: { periodo } }),
    terminales:    () => api.get('/datafonos/admin/terminales'),
    crearTerminal: (data: { serial: string; alias: string; titularId: string; sedeId?: string | null; modelo?: string }) => api.post('/datafonos/admin/terminales', data),
    probarTerminal: (id: string) => api.post(`/datafonos/admin/terminales/${id}/probar`),
    editarTerminal: (id: string, data: { alias?: string; sedeId?: string | null; activo?: boolean }) => api.put(`/datafonos/admin/terminales/${id}`, data),
    config:        () => api.get('/datafonos/admin/config'),
    guardarConfig: (comisionPct: number) => api.put('/datafonos/admin/config', { comisionPct }),
    guardarCredenciales: (titularId: string, datos: { webhookSecret?: string; businessCode?: string }) => api.put(`/datafonos/admin/empresas/${titularId}/business-code`, datos),
    sincronizar: (titularId: string, desde?: string) => api.post(`/datafonos/admin/empresas/${titularId}/sincronizar`, desde ? { desde } : {}),
    importarVentas: (titularId: string, archivo: File, comisionPct?: number) => {
      const datos = new FormData();
      datos.append('archivo', archivo);
      if (comisionPct !== undefined) datos.append('comisionPct', String(comisionPct));
      return api.post(`/datafonos/admin/empresas/${titularId}/importar-ventas`, datos, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    quitarBusinessCode: (titularId: string) => api.delete(`/datafonos/admin/empresas/${titularId}/business-code`),
    cobros:        () => api.get('/datafonos/admin/cobros'),
  },
};

export const notificationsApi = {
  list:    () => api.get('/users/notifications'),
  readAll: () => api.put('/users/notifications/read'),
  delete:  (id: string) => api.delete(`/users/notifications/${id}`),
  clear:   () => api.delete('/users/notifications'),
};

export const adminApi = {
  metrics:      () => api.get('/admin/metrics'),
  users:        (params?: any) => api.get('/admin/users', { params }),
  transactions: (params?: any) => api.get('/admin/transactions', { params }),
  chart:        (months: string) => api.get(`/admin/dashboard-chart?months=${months}`),
  createUser:   (data: any) => api.post('/admin/users', data),
  updateUser:   (id: string, data: any) => api.put(`/admin/users/${id}`, data),
  deleteUser:   (id: string) => api.delete(`/admin/users/${id}`),
  cancelarEliminacion: (id: string) => api.post(`/admin/users/${id}/cancelar-eliminacion`),
  pending:      () => api.get('/withdrawals/pending'),
  withdrawalsAll: () => api.get('/withdrawals'),
  approveWD:    (id: string, manual = false) => api.put(`/withdrawals/${id}/approve`, { manual }),
  rejectWD:     (id: string, motivo: string) => api.put(`/withdrawals/${id}/reject`, { motivo }),
  kushkiWD:     (id: string) => api.get(`/withdrawals/${id}/kushki`),
  respuestasWD: (id: string) => api.get(`/withdrawals/${id}/respuestas`),
  vinculaciones:        () => api.get('/admin/vinculaciones'),
  vinculacion:          (id: string) => api.get(`/admin/vinculaciones/${id}`),
  crearVinculacion:     (data: { razonSocial: string; nit?: string; contactoNombre: string; contactoCorreo: string }) => api.post('/admin/vinculaciones', data),
  archivoVinculacion:   (id: string, tipo: string) => api.get(`/admin/vinculaciones/${id}/documentos/${tipo}/archivo`),
  revisarDocVinculacion: (id: string, tipo: string, data: { estado: 'aprobado' | 'rechazado'; motivo?: string }) => api.put(`/admin/vinculaciones/${id}/documentos/${tipo}`, data),
  decidirVinculacion:   (id: string, data: { decision: 'aprobar' | 'solicitar_correccion' | 'rechazar'; mensaje?: string }) => api.put(`/admin/vinculaciones/${id}/decision`, data),
  enlaceVinculacion:    (id: string) => api.post(`/admin/vinculaciones/${id}/enlace`),
  enviarContrato:       (id: string, archivo: File) => {
    const form = new FormData();
    form.append('archivo', archivo);
    return api.post(`/admin/vinculaciones/${id}/contrato`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  revisarContrato:      (id: string, data: { decision: 'aprobar' | 'rechazar'; motivo?: string }) => api.put(`/admin/vinculaciones/${id}/contrato`, data),
  eliminarVinculacion:  (id: string) => api.delete(`/admin/vinculaciones/${id}`),
  kushkiPagos:     (params?: any) => api.get('/admin/kushki/pagos', { params }),
  kushkiConciliar: () => api.post('/admin/kushki/conciliar'),
  kushkiWebhooks:  () => api.get('/admin/kushki/webhooks'),
  seguridadEstado: () => api.get('/admin/seguridad/estado'),
  kushkiComercios: (params?: { q?: string; page?: number; limit?: number; todos?: number }) => api.get('/admin/kushki/comercios', { params }),
  kushkiGuardarComercio: (userId: string, data: { publicMerchantId: string; privateMerchantId: string; ambiente: string; activo: boolean }) =>
    api.put(`/admin/kushki/comercios/${userId}`, data),
  kushkiVerificarComercio: (userId: string) => api.post(`/admin/kushki/comercios/${userId}/verificar`),
  kushkiQuitarComercio: (userId: string) => api.delete(`/admin/kushki/comercios/${userId}`),
  kushkiConfigTransferencias: () => api.get('/admin/kushki/config-transferencias'),
  kushkiProbarTokenBreB: (monto?: number) => api.post('/admin/kushki/bre-b/probar-token', monto ? { monto } : {}),
  kushkiProbarWebhook: () => api.post('/admin/kushki/webhooks/probar'),
  kushkiLimpiarWebhooks: () => api.delete('/admin/kushki/webhooks'),
  comision:       () => api.get('/admin/comision'),
  guardarComision: (comisionPct: number) => api.put('/admin/comision', { comisionPct }),
  limpiezaEstado: () => api.get('/admin/limpieza'),
  limpiarDatos:   (frase: string, incluirVinculaciones = false) => api.post('/admin/limpieza', { frase, incluirVinculaciones }),
};
