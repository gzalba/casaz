# Portal de compra · Mi casa

App web para gestionar la compra de tu casa: costos de sucesión y escritura (con pagos parciales y dolarización), dinero ahorrado por cuenta, valor a pagar con la deducción de los ítems que marques, planes de pago con entrega en efectivo y cuotas, y un plan de reformas por ambiente y por rubro.

Stack: React + Vite, Firebase Authentication (Google) y Cloud Firestore.

**Acceso: una sola cuenta.** Solo `gzalba@gmail.com` puede entrar. Se controla en dos lados: la app rechaza cualquier otra cuenta de Google al iniciar sesión, y las reglas de Firestore lo vuelven a verificar en el servidor, que es lo que realmente protege los datos. Para cambiar la cuenta hay que tocar `firestore.rules` (y publicarlo) y, opcionalmente, la variable `VITE_EMAIL_AUTORIZADO`.

**Dólar de referencia:** se trae solo de [dolarapi.com](https://dolarapi.com) — blue, oficial, MEP o contado con liqui, a elección — y siempre se puede escribir a mano. Si no hay internet, se sigue usando el último valor guardado.

---

## 1. Crear el proyecto en Firebase (~5 min)

1. Entrá a https://console.firebase.google.com y tocá **Agregar proyecto**. Ponele un nombre (ej.: `portal-casa`). Podés desactivar Google Analytics.
2. Cuando esté creado, en el menú de la izquierda andá a **Compilación → Authentication → Comenzar**, elegí **Google** como proveedor, activalo y guardá.
3. Ahora **Compilación → Firestore Database → Crear base de datos**. Elegí **modo producción** y la región `southamerica-east1` (São Paulo, la más cercana).
4. Registrá la app web: en **Configuración del proyecto** (ícono de engranaje ⚙️ arriba a la izquierda) → sección **Tus apps** → ícono `</>` (Web). Ponele un apodo y registrala. Firebase te va a mostrar un objeto `firebaseConfig` con seis valores (`apiKey`, `authDomain`, etc.) — dejalos a mano para el paso 3.

## 2. Cargar las reglas de seguridad

En **Firestore Database → Reglas**, pegá el contenido del archivo `firestore.rules` de este proyecto y tocá **Publicar**. Eso deja entrar solo a la cuenta autorizada, y solo a su propio documento.

> ⚠️ Cada vez que cambie `firestore.rules` hay que volver a pegarlo y publicarlo a mano: Firebase no lo toma del repositorio.

## 3. Probarlo local (opcional pero recomendado)

Necesitás Node.js 18+ instalado.

```bash
npm install
cp .env.local.example .env.local
```

Abrí `.env.local` y completá los seis valores con los del `firebaseConfig` del paso 1. Después:

```bash
npm run dev
```

Abrí la URL que te muestra (normalmente http://localhost:5173), entrá con Google y probá cargar datos.

### Modo demo (sin Firebase ni login)

```bash
npm run dev:demo      # http://localhost:5180
```

Sirve para probar la interfaz sin tocar los datos reales: no pide login y todo se guarda solo en ese navegador. Se activa con `VITE_DEMO=1`, que en Vercel nunca está cargada.

## 4. Subir a Vercel (~5 min)

1. Subí este proyecto a un repositorio en GitHub (privado si querés).
2. Entrá a https://vercel.com, **Add New → Project**, e importá ese repo. Vercel detecta Vite solo; no cambies nada de la build.
3. Antes de deployar, abrí **Environment Variables** y cargá las mismas seis variables de tu `.env.local` (una por una: `VITE_FB_API_KEY`, `VITE_FB_AUTH_DOMAIN`, `VITE_FB_PROJECT_ID`, `VITE_FB_STORAGE_BUCKET`, `VITE_FB_MSG_SENDER_ID`, `VITE_FB_APP_ID`).
4. **Deploy**. En un par de minutos tenés tu URL `https://portal-casa-xxx.vercel.app`.

## 5. Autorizar el dominio de Vercel en Firebase

Para que el login con Google funcione en la URL de Vercel (no solo en localhost):

- Firebase → **Authentication → Settings → Dominios autorizados → Agregar dominio** y pegá tu dominio de Vercel (ej.: `portal-casa-xxx.vercel.app`).

Listo. Entrás a esa URL desde cualquier dispositivo, iniciás sesión con Google y tus datos te siguen en la nube.

---

## Notas

- **Costos**: para un solo usuario, tanto Firebase (plan Spark gratuito) como Vercel (plan Hobby gratuito) alcanzan de sobra. No necesitás cargar tarjeta.
- **Datos**: todo se guarda en un único documento `usuarios/{tu-uid}` en Firestore. Podés verlo y exportarlo desde la consola de Firebase cuando quieras.
- **Backups**: si querés, en Firestore podés programar exportaciones, o simplemente copiar el JSON del documento cada tanto.
- **Deducción**: cada ítem de Sucesión y de Escritura tiene una casilla "entra en la deducción". El valor a pagar de la casa descuenta el 50% (configurable) de la suma de los ítems tildados. Los que no se tildan no descuentan nada.
- **Planes de pago**: se elige cuánto se entrega en efectivo y en cuántas cuotas se paga el resto; la cuota se muestra en dólares y en pesos al dólar de referencia del momento.
- **Reformas**: cada una tiene ambiente, rubro, prioridad, cuándo hacerla, estado (idea → presupuestada → en curso → hecha), costo estimado y costo real. La lista se agrupa por cualquiera de esos ejes.
- **Avance global**: en Resumen, una casa que se va llenando de abajo hacia arriba según el porcentaje pagado del proyecto.
- **Informe para la parte vendedora**: desde Resumen se eligen los gastos de Sucesión y Escritura que se quieran mostrar (vienen tildados los deducibles), se agrega una nota opcional y se imprime. En el diálogo de impresión hay que elegir **Guardar como PDF**: sale una sola hoja con el detalle, el equivalente en dólares y el total a deducir.
- **Comprobantes**: cada ítem de Sucesión y Escritura acepta fotos o PDF. Las fotos se achican en el navegador antes de subirse (máximo 700 KB por archivo) y cada una va en su propio documento `usuarios/{uid}/comprobantes/{id}`, para no engordar el documento principal, que Firestore limita a 1 MB. Al borrar un ítem se borran sus comprobantes.
