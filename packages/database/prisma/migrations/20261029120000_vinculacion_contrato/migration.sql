-- AlterTable
ALTER TABLE "vinculaciones" ADD COLUMN     "contrato_estado" TEXT NOT NULL DEFAULT 'ninguno',
ADD COLUMN     "contrato_motivo" TEXT;
