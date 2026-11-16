const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

let currentQR = null;
let isConnected = false;

// Estado de cada conversa em memória
const sessions = new Map();

// Links oficiais da Baby Films
const VIDEO_INFORMATIVO = 'https://youtu.be/HLIeDSifwVA';
const VIDEO_RETROSPECTIVA = 'https://www.youtube.com/watch?v=Co_VO4x0XH8';

// Rota web para exibir o QR Code e status
app.get('/', async (req, res) => {
    if (isConnected) {
        return res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: #2e7d32;">✅ Bot Baby Films Conectado!</h1>
                <p>O atendimento automatizado está ativo e rodando 24h na nuvem.</p>
            </div>
        `);
    }

    if (!currentQR) {
        return res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h2>⏳ Gerando QR Code...</h2>
                <p>Atualize a página em alguns instantes.</p>
                <script>setTimeout(() => window.location.reload(), 3000);</script>
            </div>
        `);
    }

    try {
        const qrImage = await QRCode.toDataURL(currentQR);
        res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 40px;">
                <h1>🎬 Conectar WhatsApp da Baby Films</h1>
                <p>Abra o WhatsApp no celular > <b>Aparelhos Conectados</b> > <b>Conectar um aparelho</b> e aponte para o QR Code abaixo:</p>
                <img src="${qrImage}" style="border: 4px solid #333; border-radius: 12px; margin: 20px auto;" />
                <p style="color: #666; font-size: 14px;">A página se atualiza automaticamente.</p>
                <script>setTimeout(() => window.location.reload(), 5000);</script>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Erro ao renderizar QR Code');
    }
});

async function startBot() {
    const authDir = path.join(__dirname, 'auth_info');
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            console.log('Novo QR Code gerado. Acesse a página web ou o terminal para escanear.');
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão encerrada. Reconectando:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ WhatsApp conectado com sucesso à Baby Films!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            // Ignorar mensagens de grupos ou canais
            if (!from.endsWith('@s.whatsapp.net')) continue;

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                ''
            ).trim();

            if (!text) continue;

            // Recupera ou cria o estado da sessão do cliente
            let session = sessions.get(from);
            if (!session) {
                session = { step: 0, data: {} };
                sessions.set(from, session);
            }

            // Simular digitação para humanização
            await sock.sendPresenceUpdate('composing', from);
            await new Promise(r => setTimeout(r, 1500));

            switch (session.step) {
                case 0:
                    // Etapa 1: Boas-vindas transparentes + Pergunta Data e Local
                    await sock.sendMessage(from, {
                        text: `Olá! Tudo bem? Seja muito bem-vindo(a) à *Baby Films*! 🎬✨\n\nNeste primeiro momento você está falando com o *assistente virtual da Baby Films*. Estou aqui para entender os detalhes da sua comemoração e, logo em seguida, o *Cristiano* vai assumir a conversa para conversar pessoalmente com você com todo o carinho!\n\nPara já conferirmos a nossa disponibilidade de agenda, me conta por favor:\n👉 *Qual é a data prevista para a festa e em qual cidade ou espaço ela vai acontecer?*`
                    });
                    session.step = 1;
                    break;

                case 1:
                    // Salva data e local e pergunta sobre a criança
                    session.data.dataLocal = text;
                    await sock.sendMessage(from, {
                        text: `Que maravilha! Já anotei aqui.\n\nE me diga: *qual é o nome do(a) aniversariante e quantos aninhos vai comemorar?*`
                    });
                    session.step = 2;
                    break;

                case 2:
                    // Salva dados da criança, envia transição e os vídeos
                    session.data.crianca = text;

                    await sock.sendMessage(from, {
                        text: `Perfeito! É um momento tão especial na vida da família! 💛\n\nAntes de falarmos sobre valores e contratos, o Cristiano faz questão que você conheça como nós contamos essas histórias com toda a emoção e qualidade. Separei dois vídeos bem curtinhos para você:`
                    });

                    await new Promise(r => setTimeout(r, 1200));

                    await sock.sendMessage(from, {
                        text: `🎥 *Como funciona a nossa filmagem de festa:*\n${VIDEO_INFORMATIVO}\n\n🎞️ *Exemplo da nossa Retrospectiva:*\n${VIDEO_RETROSPECTIVA}\n\nDá uma olhadinha neles com calma! Assim que você assistir, me manda um *ok* por aqui.`
                    });
                    session.step = 3;
                    break;

                case 3:
                    // Passagem de bastão para o Cristiano
                    session.data.confirmacao = text;
                    await sock.sendMessage(from, {
                        text: `Excelente! Já passei todos os detalhes da sua festa para o *Cristiano* da Baby Films.\n\nEle já está acessando a conversa agora mesmo para te apresentar os pacotes, esclarecer qualquer dúvida e dar continuidade ao seu orçamento pessoalmente. Até logo! 🎥✨`
                    });

                    console.log(`\n🔔 NOVO LEAD QUALIFICADO BABY FILMS:\nCliente: ${from}\nData/Local: ${session.data.dataLocal}\nCriança: ${session.data.crianca}\nStatus: Pronto para fechamento\n`);

                    session.step = 4; // Finalizado
                    break;

                default:
                    // Se o atendimento já foi transferido para o Cristiano, o bot não responde mais
                    break;
            }
        }
    });
}

app.listen(PORT, () => {
    console.log(`Servidor web do Bot Baby Films rodando na porta ${PORT}`);
    startBot();
});
