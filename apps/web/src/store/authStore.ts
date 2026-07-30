import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '@/lib/api';

export interface User {
  id: string;
  cedula: string;
  nombre: string;
  correo: string;
  celular?: string;
  ciudad?: string;
  rol: string;
  subRol?: string;
  codigoReferido?: string;
  saldo: number;
  walletId?: string;
  kycVerificado: boolean;
  avatarDataUrl?: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (cedula: string, pin: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateBalance: (saldo: number) => void;
  updateProfilePhoto: (avatarDataUrl: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,

      login: async (cedula, pin) => {
        set({ isLoading: true });
        try {
          const { data } = await authApi.login({ cedula, pin });
          if (!data.ok) throw new Error(data.mensaje);
          localStorage.setItem('accessToken',  data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          set({ user: { ...data.usuario, avatarDataUrl: get().user?.id === data.usuario?.id ? get().user?.avatarDataUrl : data.usuario?.avatarDataUrl }, accessToken: data.accessToken, isLoading: false });
        } catch (err: any) {
          set({ isLoading: false });
          throw new Error(err.response?.data?.mensaje || err.message || 'Error al iniciar sesión');
        }
      },

      register: async (formData) => {
        set({ isLoading: true });
        try {
          const { data } = await authApi.register(formData);
          if (!data.ok) throw new Error(data.mensaje);
          localStorage.setItem('accessToken',  data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          set({ user: { ...data.usuario, avatarDataUrl: get().user?.id === data.usuario?.id ? get().user?.avatarDataUrl : data.usuario?.avatarDataUrl }, accessToken: data.accessToken, isLoading: false });
        } catch (err: any) {
          set({ isLoading: false });
          throw new Error(err.response?.data?.mensaje || err.message || 'Error creando cuenta');
        }
      },

      logout: async () => {
        try { await authApi.logout(); } catch {}
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ user: null, accessToken: null });
      },

      refreshUser: async () => {
        try {
          const { data } = await authApi.me();
          if (data.ok) {
            const current = get().user;
            set({ user: { ...data.usuario, avatarDataUrl: current?.id === data.usuario?.id ? current?.avatarDataUrl : data.usuario?.avatarDataUrl } });
          }
        } catch {}
      },

      updateBalance: (saldo) => {
        const user = get().user;
        if (user) set({ user: { ...user, saldo } });
      },

      updateProfilePhoto: (avatarDataUrl) => {
        const user = get().user;
        if (user) set({ user: { ...user, avatarDataUrl } });
      },
    }),
    {
      name: 'trendpay-auth',
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken }),
    }
  )
);
