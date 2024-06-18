const cors = require('cors');
const multer = require('multer');
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// MySQL 데이터베이스 연결 설정
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '12345678',
    database: process.env.DB_NAME || 'wkn_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// MySQL 연결 테스트
pool.getConnection().then(connection => {
    console.log('MySQL 연결 성공!');
    connection.release();
}).catch(err => {
    console.error('MySQL 연결 실패:', err);
});

// multer 설정
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../../uploads')); // 경로 수정
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // URL-encoded bodies를 파싱하기 위해 추가

// HTTP 서버 생성
const server = http.createServer(app);

// Socket.IO 서버 생성
const io = socketIo(server, {
    cors: {
        origin: '*', // 허용할 클라이언트의 URL
        methods: ['GET', 'POST'],
    },
});

// 데이터베이스 연결 및 쿼리 수행 함수
async function queryDatabase(query, params = []) {
    let connection;
    try {
        connection = await pool.getConnection();
        const [results] = await connection.query(query, params);
        connection.release();
        return results;
    } catch (error) {
        if (connection) connection.release();
        throw error;
    }
}

// 사용자가 채팅방에 입장할 때 클라이언트에게 사용자 목록을 업데이트하는 이벤트 발송
async function sendUpdatedUserList(chatroomId) {
    try {
        const rows = await queryDatabase('SELECT DISTINCT username FROM chat WHERE chatroom_id = ?', [chatroomId]);
        const users = rows.map(row => row.username);
        io.to(chatroomId).emit('updateUsers', users); // 특정 방의 모든 클라이언트에게 업데이트된 사용자 목록을 보냄
    } catch (error) {
        console.error('사용자 목록 조회 및 업데이트 오류:', error);
    }
}

// Socket.IO 이벤트 처리
io.on('connection', (socket) => {
    console.log('새로운 클라이언트 연결됨');

    let chatRoomId; // 클라이언트가 속한 채팅방 ID를 저장할 변수

    // 클라이언트가 채팅방에 입장할 때 채팅방 ID를 받아옴
    socket.on('joinRoom', async (roomId) => {
        console.log(`클라이언트가 ${roomId} 채팅방에 입장함`);
        chatRoomId = roomId;
        socket.join(chatRoomId);

        // 이전 메시지 가져와서 클라이언트에게 전송
        try {
            const rows = await queryDatabase('SELECT * FROM chat WHERE chatroom_id = ? ORDER BY timestamp ASC', [chatRoomId]);
            socket.emit('initialMessages', rows);
        } catch (err) {
            console.error('이전 메시지 조회 오류:', err);
        }
    });

    // 기존 메시지 전송
    socket.on('Chat', async (msg) => {
        console.log('받은 메시지:', msg);

        // 메시지 저장
        try {
            const query = 'INSERT INTO chat (username, message, chatroom_id) VALUES (?, ?, ?)';
            const result = await queryDatabase(query, [msg.username, msg.message, msg.chatroom]);
            const newMessage = { id: result.insertId, username: msg.username, message: msg.message, chatroom: msg.chatroom, timestamp: new Date() };
            io.emit('Chat', newMessage); // 메시지를 모든 클라이언트에게 브로드캐스트
        } catch (err) {
            console.error('메시지 저장 오류:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log('클라이언트 연결 종료');
    });
});

// 모든 채팅방 목록을 가져오는 엔드포인트
app.get('/api/chatrooms', async (req, res) => {
    try {
        const results = await queryDatabase('SELECT DISTINCT chatroom_id FROM chat');
        const chatrooms = results.map(row => row.chatroom_id);
        res.json(chatrooms);
    } catch (err) {
        console.error('채팅방 목록 조회 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// 특정 채팅방의 현재 채팅 중인 사용자 목록을 가져오는 엔드포인트
app.get('/api/chatrooms/:chatroomId/users', async (req, res) => {
    const { chatroomId } = req.params;

    try {
        const rows = await queryDatabase('SELECT DISTINCT username FROM chat WHERE chatroom_id = ?', [chatroomId]);
        const users = rows.map(row => row.username);
        res.json(users);
    } catch (error) {
        console.error('채팅방 사용자 조회 오류:', error);
        res.status(500).json({ error: error.message });
    }
});

// 유저가 참여 중인 채팅방 목록을 가져오는 엔드포인트
app.get('/api/users/:username/chatrooms', async (req, res) => {
    const { username } = req.params;

    try {
        const results = await queryDatabase('SELECT DISTINCT chatroom_id FROM chat WHERE username = ?', [username]);
        const chatrooms = results.map(row => row.chatroom_id);
        res.json(chatrooms);
    } catch (err) {
        console.error('유저의 채팅방 목록 조회 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// 회원가입 엔드포인트
app.post('/api/signup', async (req, res) => {
    const { username, password, email } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await queryDatabase('INSERT INTO users (username, password, email) VALUES (?, ?, ?)', [username, hashedPassword, email]);

        console.log('회원가입 성공');
        res.json({ success: true });
    } catch (error) {
        console.error('회원가입 실패:', error);
        res.status(500).json({ error: '회원가입 실패' });
    }
});

// 로그인 처리
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const rows = await queryDatabase('SELECT * FROM users WHERE email = ?', [email]);

        if (rows.length > 0) {
            const hashedPasswordFromDB = rows[0].password;
            const match = await bcrypt.compare(password, hashedPasswordFromDB);

            if (match) {
                console.log('로그인 성공:', rows[0].username);
                res.status(200).json({ email: rows[0].email });
            } else {
                console.log('로그인 실패: 잘못된 이메일 또는 비밀번호');
                res.status(401).send('로그인 실패: 잘못된 이메일 또는 비밀번호');
            }
        } else {
            console.log('로그인 실패: 잘못된 이메일 또는 비밀번호');
            res.status(401).send('로그인 실패: 잘못된 이메일 또는 비밀번호');
        }
    } catch (err) {
        console.error('로그인 오류:', err);
        res.status(500).send('로그인 오류가 발생했습니다.');
    }
});

// SMTP 설정
const transporter = nodemailer.createTransport({
    host: 'smtp.naver.com',
    port: 465,
    secure: true, // SSL 사용
    auth: {
        user: 'fly1043@naver.com',
        pass: process.env.EMAIL_PASSWORD, // 네이버 계정의 앱 비밀번호
    },
});

// 인증번호 전송 엔드포인트
app.post('/api/send-code', (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6자리 인증번호 생성
    emailCodes[email] = code;

    const mailOptions = {
        from: 'fly1043@naver.com',
        to: email,
        subject: '[WKN] 인증번호를 안내해드립니다.',
        text: `인증번호는 ${code}입니다.`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log(error);
            return res.status(500).send('인증번호 발송에 실패했습니다.');
        }
        res.send({ message: '인증번호가 이메일로 발송되었습니다.' });
    });
});

// 인증번호 확인 엔드포인트
app.post('/api/verify-code', (req, res) => {
    const { email, code } = req.body;
    if (emailCodes[email] && emailCodes[email] === code) {
        verifiedEmails[email] = true; // 인증 성공 시 인증 상태 저장
        delete emailCodes[email]; // 인증번호 삭제
        res.send({ message: '인증이 완료되었습니다.', verified: true });
    } else {
        res.status(400).send({ message: '인증번호가 일치하지 않습니다.' });
    }
});

// 비밀번호 재설정 엔드포인트
app.post('/api/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;

    try {
        // 인증이 완료된 경우에만 비밀번호 재설정
        if (!verifiedEmails[email]) {
            return res.status(400).send('인증되지 않은 요청입니다.');
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        await queryDatabase('UPDATE users SET password = ? WHERE email = ?', [passwordHash, email]);

        delete verifiedEmails[email];

        res.send({ message: '비밀번호가 성공적으로 재설정되었습니다.' });
    } catch (error) {
        console.error('비밀번호 재설정 실패:', error.message);
        res.status(500).send('비밀번호 재설정에 실패했습니다.');
    }
});

// 사용자 데이터 가져오기 엔드포인트
app.get('/api/userdata', async (req, res) => {
    const { email } = req.query;

    try {
        const rows = await queryDatabase('SELECT username FROM users WHERE email = ?', [email]);

        if (rows.length > 0) {
            res.status(200).json({ username: rows[0].username });
        } else {
            res.status(404).send('사용자를 찾을 수 없습니다.');
        }
    } catch (error) {
        console.error('사용자 데이터 가져오기 실패:', error);
        res.status(500).send('사용자 데이터 가져오기 실패');
    }
});

// 로그아웃 처리 엔드포인트
app.post('/api/logout', (req, res) => {
    res.status(200).send('로그아웃 성공');
});

// 비밀번호 확인 및 회원 탈퇴 엔드포인트
app.post('/api/confirmPasswordAndWithdraw', async (req, res) => {
    const { email, password } = req.body;

    try {
        const rows = await queryDatabase('SELECT * FROM users WHERE email = ?', [email]);

        if (rows.length > 0) {
            const user = rows[0];
            const passwordMatch = await bcrypt.compare(password, user.password);

            if (passwordMatch) {
                await queryDatabase('DELETE FROM comments WHERE author = ?', [email]);
                await queryDatabase('DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author = ?)', [email]);
                await queryDatabase('DELETE FROM posts WHERE author = ?', [email]);
                await queryDatabase('DELETE FROM chat WHERE username = ?', [user.username]);
                await queryDatabase('DELETE FROM users WHERE email = ?', [email]);

                console.log('회원 탈퇴 성공:', email);
                res.status(200).json({ success: true });
            } else {
                console.log('비밀번호 불일치');
                res.status(401).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
            }
        } else {
            console.log('회원 탈퇴 실패: 해당 이메일이 존재하지 않습니다.');
            res.status(404).json({ success: false, message: '회원 탈퇴 실패: 해당 이메일이 존재하지 않습니다.' });
        }
    } catch (err) {
        console.error('회원 탈퇴 오류:', err);
        res.status(500).json({ success: false, message: '회원 탈퇴 오류가 발생했습니다.' });
    }
});

// 정적 파일 서빙 설정
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// 게시글 작성 엔드포인트
app.post('/api/posts', upload.single('image'), async (req, res) => {
    const { title, content, category, author } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        await queryDatabase(
            'INSERT INTO posts (title, content, category, author, imageUrl, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [title, content, category, author, imageUrl]
        );

        res.status(201).send('게시글이 성공적으로 저장되었습니다.');
    } catch (error) {
        console.error('게시글 저장 실패:', error.message);
        res.status(500).send('게시글 저장 실패');
    }
});

// 게시글 목록 조회 엔드포인트
app.get('/api/posts', async (req, res) => {
    try {
        const rows = await queryDatabase('SELECT id, title, author, category, created_at FROM posts');
        res.status(200).json(rows);
    } catch (error) {
        console.error('게시글 정보 가져오기 실패:', error);
        res.status(500).send('게시글 정보 가져오기 실패');
    }
});

// 특정 게시글 정보 조회 엔드포인트
app.get('/api/posts/:id', async (req, res) => {
    const postId = req.params.id;

    try {
        const rows = await queryDatabase('SELECT title, author, content, category, imageUrl, created_at FROM posts WHERE id = ?', [postId]);

        if (rows.length > 0) {
            res.status(200).json(rows[0]);
        } else {
            res.status(404).send('게시글을 찾을 수 없습니다.');
        }
    } catch (error) {
        console.error('게시글 정보 가져오기 실패:', error);
        res.status(500).send('게시글 정보 가져오기 실패');
    }
});

// 게시글 수정 엔드포인트 추가
app.put('/api/posts/:id', async (req, res) => {
    const postId = req.params.id;
    const { title, content } = req.body;

    try {
        const result = await queryDatabase(
            'UPDATE posts SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP, created_at = IFNULL(created_at, CURRENT_TIMESTAMP) WHERE id = ?',
            [title, content, postId]
        );

        if (result.affectedRows === 0) {
            res.status(404).send('게시글을 찾을 수 없습니다.');
        } else {
            res.status(200).send('게시글이 성공적으로 수정되었습니다.');
        }
    } catch (error) {
        console.error('게시글 수정 실패:', error);
        res.status(500).send('게시글 수정 실패');
    }
});

// 게시글 삭제 엔드포인트 추가
app.delete('/api/posts/:id', async (req, res) => {
    const postId = req.params.id;

    try {
        await queryDatabase('DELETE FROM comments WHERE post_id = ?', [postId]);
        const result = await queryDatabase('DELETE FROM posts WHERE id = ?', [postId]);

        if (result.affectedRows === 0) {
            res.status(404).send('게시글을 찾을 수 없습니다.');
        } else {
            res.status(200).send('게시글이 성공적으로 삭제되었습니다.');
        }
    } catch (error) {
        console.error('게시글 삭제 실패:', error);
        res.status(500).send('게시글 삭제 실패');
    }
});

// 댓글 저장 엔드포인트
app.post('/api/posts/:id/comments', async (req, res) => {
    const postId = req.params.id;
    const { author, content } = req.body;

    // 현재 시간을 작성일로 설정
    const created_at = new Date();

    if (!author || !content) {
        res.status(400).send('작성자와 내용은 필수입니다.');
        return;
    }

    try {
        const postExists = await queryDatabase('SELECT 1 FROM posts WHERE id = ?', [postId]);
        if (postExists.length === 0) {
            res.status(404).send('게시글을 찾을 수 없습니다.');
            return;
        }

        await queryDatabase(
            'INSERT INTO comments (post_id, author, content, created_at) VALUES (?, ?, ?, ?)',
            [postId, author, content, created_at]
        );

        res.status(200).send('댓글이 성공적으로 저장되었습니다.');
    } catch (error) {
        console.error('댓글 저장 실패:', error);
        res.status(500).send('댓글 저장 실패');
    }
});

// 댓글 가져오는 엔드포인트
app.get('/api/posts/:id/comments', async (req, res) => {
    const postId = req.params.id;

    try {
        const postExists = await queryDatabase('SELECT 1 FROM posts WHERE id = ?', [postId]);
        if (postExists.length === 0) {
            res.status(404).send('게시글을 찾을 수 없습니다.');
            return;
        }

        const comments = await queryDatabase('SELECT * FROM comments WHERE post_id = ?', [postId]);
        res.status(200).json(comments);
    } catch (error) {
        console.error('댓글 가져오기 실패:', error);
        res.status(500).send('댓글 가져오기 실패');
    }
});

// 댓글 삭제 엔드포인트
app.delete('/api/posts/:postId/comments/:commentId', async (req, res) => {
    const { postId, commentId } = req.params;

    try {
        const commentExists = await queryDatabase('SELECT 1 FROM comments WHERE id = ? AND post_id = ?', [commentId, postId]);

        if (commentExists.length === 0) {
            res.status(404).send('댓글을 찾을 수 없습니다.');
            return;
        }

        await queryDatabase('DELETE FROM comments WHERE id = ? AND post_id = ?', [commentId, postId]);
        res.status(200).send('댓글이 성공적으로 삭제되었습니다.');
    } catch (error) {
        console.error('댓글 삭제 실패:', error);
        res.status(500).send('댓글 삭제 실패');
    }
});

// 뉴스 API 프록시 엔드포인트
app.get('/api/news', async (req, res) => {
    try {
        const category = req.query.category || 'all';
        const query = category === 'all' ? '' : `&category=${category}`;
        console.log(`Fetching news from newsapi.org for category: ${category}`);
        const response = await axios.get(`https://newsapi.org/v2/top-headlines?country=jp${query}&apiKey=db05eddf2a4b43c2b3378b2dbaa7eeef`);
        console.log('News fetched from newsapi.org successfully:', response.data);
        res.json(response.data);
    } catch (error) {
        console.error('뉴스 API 요청 실패:', error);
        res.status(500).send('뉴스 데이터를 가져오는 데 실패했습니다.');
    }
});

// 정적 파일 제공 설정 (프론트엔드 빌드 파일)
app.use(express.static(path.join(__dirname, '../../frontend/build')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/build', 'index.html'));
});

// 서버 시작
server.listen(port, () => {
    console.log(`서버가 https://kmk510.store:${port} 에서 실행 중입니다.`);
});