-- CreateTable
CREATE TABLE "terminales_kushki" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "modelo" TEXT NOT NULL DEFAULT 'Sunmi P3',
    "titular_id" TEXT NOT NULL,
    "sede_id" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminales_kushki_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobros_datafono" (
    "id" TEXT NOT NULL,
    "terminal_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_transaction_id" TEXT NOT NULL,
    "monto" DECIMAL(18,2) NOT NULL,
    "comision_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "estado_terminal" TEXT,
    "detalle" TEXT,
    "transaction_reference" TEXT,
    "ticket_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobros_datafono_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_datafono" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "cobro_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_datafono_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "terminales_kushki_serial_key" ON "terminales_kushki"("serial");

-- CreateIndex
CREATE INDEX "terminales_kushki_titular_id_idx" ON "terminales_kushki"("titular_id");

-- CreateIndex
CREATE INDEX "terminales_kushki_sede_id_idx" ON "terminales_kushki"("sede_id");

-- CreateIndex
CREATE UNIQUE INDEX "cobros_datafono_client_transaction_id_key" ON "cobros_datafono"("client_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "cobros_datafono_ticket_number_key" ON "cobros_datafono"("ticket_number");

-- CreateIndex
CREATE INDEX "cobros_datafono_terminal_id_estado_idx" ON "cobros_datafono"("terminal_id", "estado");

-- CreateIndex
CREATE INDEX "cobros_datafono_user_id_created_at_idx" ON "cobros_datafono"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "eventos_datafono_event_id_key" ON "eventos_datafono"("event_id");

-- CreateIndex
CREATE INDEX "eventos_datafono_cobro_id_idx" ON "eventos_datafono"("cobro_id");

-- AddForeignKey
ALTER TABLE "terminales_kushki" ADD CONSTRAINT "terminales_kushki_titular_id_fkey" FOREIGN KEY ("titular_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminales_kushki" ADD CONSTRAINT "terminales_kushki_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobros_datafono" ADD CONSTRAINT "cobros_datafono_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminales_kushki"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobros_datafono" ADD CONSTRAINT "cobros_datafono_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_datafono" ADD CONSTRAINT "eventos_datafono_cobro_id_fkey" FOREIGN KEY ("cobro_id") REFERENCES "cobros_datafono"("id") ON DELETE CASCADE ON UPDATE CASCADE;
