const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Inisialisasi Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Gunakan memoryStorage agar file disimpan sementara di RAM (aman untuk Vercel)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 1 * 1024 * 1024 } // Batasi ukuran file max 5MB (opsional)
});
const upload = multer({ storage: storage });

// Middleware
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'rahasia-sipeka-smk',
    resave: false,
    saveUninitialized: true
}));

// Auth Middleware
const isSiswa = (req, res, next) => (req.session.user && req.session.user.role === 'siswa') ? next() : res.redirect('/login');
const isGuru = (req, res, next) => (req.session.user && req.session.user.role === 'guru') ? next() : res.redirect('/login');

// Middleware khusus Super Admin
const isSuperAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'superadmin') {
        return next();
    }
    res.redirect('/login');
};

// --- ROUTES ---

// Login Page
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Ambil data user berdasarkan email
        const { data: users, error } = await supabase.from('users').select('*').eq('email', email);
        
        if (error) {
            console.error("Supabase Error:", error.message);
            return res.render('login', { error: 'Terjadi kesalahan pada database!' });
        }

        if (users && users.length > 0) {
            const user = users[0];
            
            // Periksa password menggunakan bcrypt
            const match = bcrypt.compareSync(password, user.password);
            
            if (match) {
                req.session.user = user;
                if (user.role === 'superadmin') {
                    return res.redirect('/dashboard/admin');
                }
                else if (user.role === 'guru') {
                    return res.redirect('/dashboard/guru');
                } else {
                    return res.redirect('/dashboard/siswa');
                }
            } else {
                console.log("Password tidak cocok untuk email:", email);
            }
        } else {
            console.log("Email tidak ditemukan di database:", email);
        }

        res.render('login', { error: 'Email atau password salah!' });
    } catch (err) {
        console.error("Login Exception:", err.message);
        res.render('login', { error: 'Terjadi kesalahan sistem!' });
    }
});

// --- ROUTE KHUSUS SUPER ADMIN ---

// 1. Dashboard Super Admin (Melihat daftar guru yang sudah terdaftar)
app.get('/dashboard/admin', isSuperAdmin, async (req, res) => {
    try {
        const { data: daftarGuru, error } = await supabase
            .from('users')
            .select('*')
            .eq('role', 'guru');

        if (error) throw error;

        res.render('dashboard_admin', { 
            user: req.session.user, 
            daftarGuru: daftarGuru || [] 
        });
    } catch (err) {
        console.error("Error Dashboard Admin:", err.message);
        res.render('dashboard_admin', { user: req.session.user, daftarGuru: [] });
    }
});

// 2. Halaman Form Tambah Guru (Hanya bisa diakses Super Admin)
app.get('/admin/tambah-guru', isSuperAdmin, (req, res) => {
    res.render('tambah_guru');
});

// 3. Proses Simpan Guru Baru oleh Super Admin
app.post('/admin/tambah-guru', isSuperAdmin, async (req, res) => {
    try {
        const { nama, email, password } = req.body;
        const hashedPassword = bcrypt.hashSync(password, 10);

        const { error } = await supabase.from('users').insert([{
            nama,
            email,
            password: hashedPassword,
            role: 'guru',
            kelas: '-',
            tempat_pkl: '-'
        }]);

        if (error) throw error;
        res.redirect('/dashboard/admin');
    } catch (err) {
        console.error("Gagal tambah guru:", err.message);
        res.redirect('/dashboard/admin');
    }
});

// Register Page (Untuk Siswa)
app.get('/register', async (req, res) => {
    const { data: allUsers, error } = await supabase
        .from('users')
        .select('*');

    const gurus = allUsers ? allUsers.filter(u => u.role && u.role.trim().toLowerCase() === 'guru') : [];
    res.render('register', { gurus: gurus, error: null });
});

app.post('/register', async (req, res) => {
    try {
        const { nama, email, password, kelas, tempatPkl, guruPembimbing } = req.body;
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        const { error } = await supabase.from('users').insert([{
            nama, email, password: hashedPassword, role: 'siswa',
            kelas, tempat_pkl: tempatPkl, guru_pembimbing: guruPembimbing
        }]);

        if (error) throw error;
        res.redirect('/login');
    } catch (err) {
        res.send('Terjadi kesalahan saat registrasi: ' + err.message);
    }
});

// Dashboard Siswa
app.get('/dashboard/siswa', isSiswa, async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    const { data: absensiList } = await supabase
        .from('attendances')
        .select('*')
        .eq('siswa_id', req.session.user.id)
        .eq('tanggal', today);

    const absensiHariIni = absensiList && absensiList.length > 0 ? absensiList[0] : null;

    const { data: riwayatAbsen } = await supabase
        .from('attendances')
        .select('*')
        .eq('siswa_id', req.session.user.id)
        .order('tanggal', { ascending: false });

    res.render('dashboard_siswa', { 
        user: req.session.user, 
        absensi: absensiHariIni, 
        riwayat: riwayatAbsen || [] 
    });
});

// Aksi Absen Masuk
app.post('/absen/masuk', isSiswa, upload.single('foto'), async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const { lokasi } = req.body;
    const foto = req.file ? req.file.filename : null;
    const jam = new Date().toLocaleTimeString();

    await supabase.from('attendances').insert([{
        siswa_id: req.session.user.id,
        tanggal: today,
        jam_masuk: jam,
        foto_masuk: foto,
        lokasi_masuk: lokasi
    }]);

    res.redirect('/dashboard/siswa');
});

// Aksi Absen Pulang & Jurnal
app.post('/absen/pulang', isSiswa, upload.single('foto'), async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const { lokasi, jurnalHarian } = req.body;
    const foto = req.file ? req.file.filename : null;
    const jam = new Date().toLocaleTimeString();

    await supabase
        .from('attendances')
        .update({
            jam_pulang: jam,
            foto_pulang: foto,
            lokasi_pulang: lokasi,
            jurnal_harian: jurnalHarian
        })
        .eq('siswa_id', req.session.user.id)
        .eq('tanggal', today);

    res.redirect('/dashboard/siswa');
});

// Dashboard Guru dengan Filter
app.get('/dashboard/guru', isGuru, async (req, res) => {
    try {
        const { tanggal, tempat_pkl } = req.query;
        const guruId = req.session.user.id;

        let query = supabase
            .from('attendances')
            .select(`
                *,
                users:siswa_id ( id, nama, kelas, tempat_pkl, guru_pembimbing )
            `)
            .order('tanggal', { ascending: false });

        if (tanggal) {
            query = query.eq('tanggal', tanggal);
        }

        const { data: rekap, error } = await query;
        if (error) throw error;

        let filteredRekap = (rekap || []).filter(item => {
            return item.users && item.users.guru_pembimbing === guruId;
        });

        if (tempat_pkl) {
            filteredRekap = filteredRekap.filter(item => 
                item.users && item.users.tempat_pkl && 
                item.users.tempat_pkl.toLowerCase().includes(tempat_pkl.toLowerCase())
            );
        }

        const { data: myStudents } = await supabase
            .from('users')
            .select('tempat_pkl')
            .eq('role', 'siswa')
            .eq('guru_pembimbing', guruId);
            
        const daftarTempatPkl = [...new Set(myStudents?.map(u => u.tempat_pkl).filter(Boolean))];

        res.render('dashboard_guru', { 
            user: req.session.user, 
            rekap: filteredRekap,
            daftarTempatPkl,
            filter: { tanggal: tanggal || '', tempat_pkl: tempat_pkl || '' }
        });
    } catch (err) {
        console.error("Error Dashboard Guru:", err.message);
        res.render('dashboard_guru', { user: req.session.user, rekap: [], daftarTempatPkl: [], filter: { tanggal: '', tempat_pkl: '' } });
    }
});

// Guru Tambah Siswa Baru
app.post('/guru/tambah-siswa', isGuru, async (req, res) => {
    try {
        const { nama, email, password, kelas, tempat_pkl } = req.body;
        const hashedPassword = bcrypt.hashSync(password, 10);

        const { error } = await supabase.from('users').insert([{
            nama,
            email,
            password: hashedPassword,
            role: 'siswa',
            kelas,
            tempat_pkl,
            guru_pembimbing: req.session.user.id
        }]);

        if (error) throw error;
        res.redirect('/dashboard/guru');
    } catch (err) {
        console.error("Gagal tambah siswa:", err.message);
        res.redirect('/dashboard/guru');
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sipeka Server running on port ${PORT}`));

// --- SCRIPT SEED OTOMATIS ---

async function seedAdminGuru() {
    const emailGuru = 'dinda@gmail.com';
    const passwordPlain = 'guru123';
    
    const { data: existing } = await supabase.from('users').select('*').eq('email', emailGuru);
    const hashedPassword = bcrypt.hashSync(passwordPlain, 10);

    if (!existing || existing.length === 0) {
        await supabase.from('users').insert([{
            nama: 'Dinda Nurrahma',
            email: emailGuru,
            password: hashedPassword,
            role: 'guru'
        }]);
        console.log("Akun guru berhasil dibuat otomatis dengan bcrypt!");
    } else {
        await supabase.from('users').update({ password: hashedPassword }).eq('email', emailGuru);
        console.log("Password akun guru berhasil di-refresh dengan hash bcrypt yang valid!");
    }
}
seedAdminGuru();

async function seedSuperAdmin() {
    const emailAdmin = 'admin@gmail.com'; 
    const passwordPlain = 'admin123'; 
    
    const { data: existing } = await supabase.from('users').select('*').eq('email', emailAdmin);
    const hashedPassword = bcrypt.hashSync(passwordPlain, 10);

    if (!existing || existing.length === 0) {
        await supabase.from('users').insert([{
            nama: 'Super Admin Sipeka',
            email: emailAdmin,
            password: hashedPassword,
            role: 'superadmin',
            kelas: '-',
            tempat_pkl: '-'
        }]);
        console.log("Akun Super Admin berhasil dibuat!");
    }
}
seedSuperAdmin();

async function resetAdminPassword() {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    const { error } = await supabase
        .from('users')
        .update({ password: hashedPassword })
        .eq('email', 'admin@gmail.com');

    if (!error) {
        console.log("Password Super Admin berhasil diperbarui!");
    } else {
        console.error("Gagal reset password:", error.message);
    }
}
resetAdminPassword();
