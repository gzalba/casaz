# Portal de compra · Mi casa

App web para gestionar la compra de tu casa: costos de sucesión y escritura (con pagos parciales y dolarización), dinero ahorrado por cuenta, valor a pagar con la deducción del 50% de sucesión, planes de pago y reformas priorizadas.

Stack: React + Vite, Firebase Authentication (Google) y Cloud Firestore. Login con Google, un único usuario: cada persona solo ve y edita su propio documento.

---

## 1. Crear el proyecto en Firebase (~5 min)

1. Entrá a https://console.firebase.google.com y tocá **Agregar proyecto**. Ponele un nombre (ej.: `portal-casa`). Podés desactivar Google Analytics.
2. Cuando esté creado, en el menú de la izquierda andá a **Compilación → Authentication → Comenzar**, elegí **Google** como proveedor, activalo y guardá.
3. Ahora **Compilación → Firestore Database → Crear base de datos**. Elegí **modo producción** y la región `southamerica-east1` (São Paulo, la más cercana).
4. Registrá la app web: en **Configuración del proyecto** (ícono de engranaje ⚙️ arriba a la izquierda) → sección **Tus apps** → ícono `</>` (Web). Ponele un apodo y registrala. Firebase te va a mostrar un objeto `firebaseConfig` con seis valores (`apiKey`, `authDomain`, etc.) — dejalos a mano para el paso 3.

## 2. Cargar las reglas de seguridad

En **Firestore Database → Reglas**, pegá el contenido del archivo `firestore.rules` de este proyecto y publicá. Eso garantiza que cada usuario solo pueda tocar su propio documento.

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
