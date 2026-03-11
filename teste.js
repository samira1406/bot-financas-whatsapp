import baileys from "@whiskeysockets/baileys"
import P from "pino"
import qrcode from "qrcode-terminal"

const { 
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = baileys

async function start() {

    const { state, saveCreds } = await useMultiFileAuthState("auth")

    const { version } = await fetchLatestBaileysVersion()

    console.log("Versão WA:", version)

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" }),
        version,
        browser: ["Windows", "Chrome", "120.0.0"]
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", (update) => {

        const { connection, qr } = update

        if (qr) {
            console.log("QR RECEBIDO")
            qrcode.generate(qr, { small: true })
        }

        if (connection === "open") {
            console.log("CONECTADO")
        }

        if (connection === "close") {
            console.log("CONEXÃO FECHOU")
        }

    })

}

start()