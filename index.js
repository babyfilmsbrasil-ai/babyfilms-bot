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
let waSocket = null;

// Estado de cada conversa em memória
const sessions = new Map();

// Links e Dados oficiais da Baby Films
const VIDEO_INFORMATIVO = 'https://youtu.be/HLIeDSifwVA';
const VIDEO_RETROSPECTIVA = 'https://www.youtube.com/watch?v=Co_VO4x0XH8';
const CHAVE_PIX = '55996208688';
const TITULAR_PIX = 'Cristiano Lopes Brasil';

// Carregar lembretes de parcelas
const LEMBRETES_FILE = path.join(__dirname, 'lembretes_parcelas.json');
function carregarLembretes() {
    if (!fs.existsSync(LEMBRETES_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(LEMBRETES_FILE, 'utf-8'));
    } catch (e) {
        console.error('Erro ao ler lembretes_parcelas.json:', e);
        return [];
    }
}

function salvarLembretes(dados) {
    try {
        fs.writeFileSync(LEMBRETES_FILE, JSON.stringify(dados, null, 2), 'utf-8');
    } catch (e) {
        console.error('Erro ao salvar lembretes:', e);
    }
}

// Rota web para exibir o QR Code e status do Bot
app.get('/', async (req, res) => {
    if (isConnected) {
        return res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: #2e7d32;">✅ Bot Baby Films Conectado!</h1>
                <p>O atendimento automatizado e o gestor de lembretes estão ativos 24h na nuvem.</p>
                <div style="margin-top: 25px;">
                    <a href="/lembretes" style="background: #0288d1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">📊 Ver Painel de Lembretes e Parcelas</a>
                </div>
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

// Painel web de Lembretes de Parcelas
app.get('/lembretes', (req, res) => {
    const clientes = carregarLembretes();
    let tabela = '';

    for (const c of clientes) {
        for (const p of c.parcelas) {
            const badgeCor = p.status === 'pago' ? '#2e7d32' : '#e65100';
            const badgeTxt = p.status === 'pago' ? 'Pago' : 'Pendente';
            tabela += `
                <tr style="border-bottom: 1px solid #ddd; text-align: left;">
                    <td style="padding: 10px;"><b>${c.cliente}</b></td>
                    <td style="padding: 10px;">${c.whatsapp}</td>
                    <td style="padding: 10px;">${c.evento}</td>
                    <td style="padding: 10px;">${p.numero}ª parcela</td>
                    <td style="padding: 10px;"><b>${p.valor}</b></td>
                    <td style="padding: 10px;">${p.vencimento}</td>
                    <td style="padding: 10px;"><span style="background: ${badgeCor}; color: white; padding: 3px 8px; border-radius: 10px; font-size: 12px;">${badgeTxt}</span></td>
                </tr>
            `;
        }
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Lembretes de Parcelas - Baby Films</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 20px; }
                .card { background: white; border-radius: 8px; padding: 25px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 1000px; margin: auto; }
                h1 { color: #1a237e; margin-top: 0; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th { background: #e8eaf6; padding: 12px 10px; text-align: left; }
                .btn { background: #2e7d32; color: white; padding: 10px 16px; border: none; border-radius: 6px; cursor: pointer; text-decoration: none; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🎬 Gestão de Parcelas & Lembretes - Baby Films</h1>
                <p>Status WhatsApp: <b>${isConnected ? '✅ Conectado' : '❌ Desconectado'}</b> | Chave Pix cadastrada: <b>${CHAVE_PIX}</b> (${TITULAR_PIX})</p>
                <div style="margin: 15px 0;">
                    <a href="/disparar-checagem" class="btn">⚡ Verificar e Disparar Lembretes Agora</a>
                    <a href="/" style="margin-left: 15px; color: #555;">Voltar ao Início</a>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Cliente</th>
                            <th>WhatsApp</th>
                            <th>Evento</th>
                            <th>Parcela</th>
                            <th>Valor</th>
                            <th>Vencimento</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tabela}
                    </tbody>
                </table>
            </div>
        </body>
        </html>
    `);
});

// Rota manual para forçar verificação de lembretes
app.get('/disparar-checagem', async (req, res) => {
    if (!isConnected || !waSocket) {
        return res.send('<h3>⚠️ O bot precisa estar conectado ao WhatsApp para disparar lembretes. <a href="/">Conectar</a></h3>');
    }
    const enviados = await verificarEDispararLembretes();
    res.send(`
        <div style="font-family: Arial; padding: 30px; text-align: center;">
            <h2>✅ Checagem concluída!</h2>
            <p>${enviados.length > 0 ? `Lembretes enviados para: ${enviados.join(', ')}` : 'Nenhuma parcela com vencimento para hoje ou 3 dias antes.'}</p>
            <br/><a href="/lembretes">Voltar ao painel</a>
        </div>
    `);
});

// Função automática para checagem de parcelas
async function verificarEDispararLembretes() {
    if (!isConnected || !waSocket) return [];
    const clientes = carregarLembretes();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const enviados = [];

    for (const c of clientes) {
        for (const p of c.parcelas) {
            if (p.status !== 'pendente' || !p.vencimento.includes('/')) continue;

            const [dia, mes, ano] = p.vencimento.split('/').map(Number);
            const dataVenc = new Date(ano, mes - 1, dia);
            dataVenc.setHours(0, 0, 0, 0);

            const diffDias = Math.round((dataVenc - hoje) / (1000 * 60 * 60 * 24));

            let motivo = null;
            if (diffDias === 3) {
                motivo = `vence em *3 dias* (${p.vencimento})`;
            } else if (diffDias === 0) {
                motivo = `vence *hoje* (${p.vencimento})`;
            }

            if (motivo) {
                const jid = `${c.whatsapp}@s.whatsapp.net`;
                const msg = `Olá, *${c.cliente.split(' ')[0]}*! Tudo bem? Aqui é da *Baby Films*! 🎬✨\n\nPassando com carinho para lembrar que a sua *${p.numero}ª parcela* (referente ao evento: _${c.evento}_), no valor de *${p.valor}*, ${motivo}.\n\n🔑 *Chave Pix:* ${CHAVE_PIX}\n👤 *Titular:* ${TITULAR_PIX}\n\nAssim que realizar o pagamento, basta nos enviar o comprovante por aqui. Qualquer dúvida estamos à disposição! 💛`;

                try {
                    await waSocket.sendMessage(jid, { text: msg });
                    enviados.push(`${c.cliente} (${p.vencimento})`);
                    console.log(`[LEMBRETE ENVIADO] Para ${c.cliente} (${c.whatsapp}): Parcela ${p.numero}`);
                    await new Promise(r => setTimeout(r, 2000));
                } catch (err) {
                    console.error(`Erro ao enviar lembrete para ${c.cliente}:`, err);
                }
            }
        }
    }
    return enviados;
}

// Checagem automática a cada 6 horas
setInterval(() => {
    verificarEDispararLembretes();
}, 6 * 60 * 60 * 1000);

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
    waSocket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            console.log('Novo QR Code gerado.');
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
            // Executa checagem de lembretes ao conectar
            verificarEDispararLembretes();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            if (!from.endsWith('@s.whatsapp.net')) continue;

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                ''
            ).trim();

            if (!text) continue;

            // Se for o próprio Cristiano enviando comando de checagem
            if (text === '!lembretes' || text === '!checar') {
                const enviados = await verificarEDispararLembretes();
                await sock.sendMessage(from, {
                    text: `🎬 *Relatório Baby Films:*\nChecagem de lembretes executada!\n${enviados.length > 0 ? 'Enviados hoje:\n' + enviados.join('\n') : 'Nenhuma parcela vencendo hoje ou em 3 dias.'}`
                });
                continue;
            }

            // Recupera ou cria o estado da sessão do cliente
            let session = sessions.get(from);
            if (!session) {
                session = { step: 0, data: {} };
                sessions.set(from, session);
            }

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(r => setTimeout(r, 1500));

            switch (session.step) {
                case 0:
                    // Etapa 1: Boas-vindas transparentes + Triagem de 3 opções
                    await sock.sendMessage(from, {
                        text: `Olá! Tudo bem? Seja muito bem-vindo(a) à *Baby Films*! 🎬✨\n\nNeste primeiro momento você está falando com o *assistente virtual da Baby Films* para agilizarmos seu atendimento.\n\nPara direcionar melhor o seu contato, me conta por favor o que você procura:\n\n*1* - 🎈 Filmagem de festa infantil\n*2* - 🎥 Filmagem de outro evento\n*3* - ✨ Outros serviços (retrospectivas, convites em vídeo e outros)`
                    });
                    session.step = 1;
                    break;

                case 1: {
                    const lower = text.toLowerCase();
                    if (text === '1' || lower.includes('festa infantil') || (lower.includes('infantil') && !lower.includes('outro'))) {
                        session.data.tipoServico = 'Filmagem de Festa Infantil';
                        await sock.sendMessage(from, {
                            text: `Que maravilha! Nós amamos eternizar festas infantis com toda a emoção e carinho! 💛\n\nLogo em seguida o *Cristiano* vai assumir a conversa para falar pessoalmente com você.\n\nPara já conferirmos a nossa disponibilidade de agenda, me conta por favor:\n👉 *Qual é a data prevista para a festa e em qual cidade ou espaço ela vai acontecer?*`
                        });
                        session.step = 2;
                    } else if (text === '2' || lower.includes('outro evento') || lower.includes('evento')) {
                        session.data.tipoServico = 'Filmagem de Outro Evento';
                        await sock.sendMessage(from, {
                            text: `Perfeito! Para cobertura de outros eventos, o atendimento é totalmente personalizado. O *Cristiano* já foi notificado e vai assumir esta conversa diretamente com você agora mesmo! ✨🎥\n\nSe quiser já adiantar alguns detalhes sobre a data e o tipo de evento, fique à vontade para escrever abaixo.`
                        });
                        console.log(`\n🔔 NOVO LEAD BABY FILMS (OUTRO EVENTO):\nCliente: ${from}\nOpção: Filmagem de Outro Evento -> Direto com Cristiano\n`);
                        session.step = 99;
                    } else if (text === '3' || lower.includes('outro') || lower.includes('retrospectiva') || lower.includes('convite')) {
                        session.data.tipoServico = 'Outros Serviços (Retrospectivas/Convites/etc)';
                        await sock.sendMessage(from, {
                            text: `Perfeito! Para retrospectivas, convites em vídeo e outros serviços especiais, o *Cristiano* já foi notificado e vai assumir este atendimento diretamente com você aqui no WhatsApp agora mesmo! ✨🎬\n\nSe quiser já adiantar o que você tem em mente, fique à vontade para escrever abaixo.`
                        });
                        console.log(`\n🔔 NOVO LEAD BABY FILMS (OUTROS SERVIÇOS):\nCliente: ${from}\nOpção: Outros Serviços -> Direto com Cristiano\n`);
                        session.step = 99;
                    } else {
                        await sock.sendMessage(from, {
                            text: `Por favor, responda apenas com o número da opção desejada:\n*1* - Filmagem de festa infantil\n*2* - Filmagem de outro evento\n*3* - Outros serviços`
                        });
                    }
                    break;
                }

                case 2:
                    session.data.dataLocal = text;
                    await sock.sendMessage(from, {
                        text: `Que maravilha! Já anotei aqui.\n\nE me diga: *qual é o nome do(a) aniversariante e quantos aninhos vai comemorar?*`
                    });
                    session.step = 3;
                    break;

                case 3:
                    session.data.crianca = text;

                    await sock.sendMessage(from, {
                        text: `Perfeito! É um momento tão especial na vida da família! 💛\n\nAntes de falarmos sobre valores e contratos, o Cristiano faz questão que você conheça como nós contamos essas histórias com toda a emoção e qualidade. Separei dois vídeos bem curtinhos para você:`
                    });

                    await new Promise(r => setTimeout(r, 1200));

                    await sock.sendMessage(from, {
                        text: `🎥 *Como funciona a nossa filmagem de festa:*\n${VIDEO_INFORMATIVO}\n\n🎞️ *Exemplo da nossa Retrospectiva:*\n${VIDEO_RETROSPECTIVA}\n\nDá uma olhadinha neles com calma! Assim que você assistir, me manda um *ok* por aqui.`
                    });
                    session.step = 4;
                    break;

                case 4:
                    session.data.confirmacao = text;
                    await sock.sendMessage(from, {
                        text: `Excelente! Já passei todos os detalhes da sua festa para o *Cristiano* da Baby Films.\n\nEle já está acessando a conversa agora mesmo para te apresentar os pacotes, esclarecer qualquer dúvida e dar continuidade ao seu orçamento pessoalmente. Até logo! 🎥✨`
                    });

                    console.log(`\n🔔 NOVO LEAD QUALIFICADO BABY FILMS:\nCliente: ${from}\nServiço: ${session.data.tipoServico}\nData/Local: ${session.data.dataLocal}\nCriança: ${session.data.crianca}\nStatus: Pronto para fechamento\n`);

                    session.step = 99;
                    break;

                default:
                    break;
            }
        }
    });
}

app.listen(PORT, () => {
    console.log(`Servidor web do Bot Baby Films rodando na porta ${PORT}`);
    startBot();
});
