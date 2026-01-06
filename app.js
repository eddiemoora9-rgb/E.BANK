/************************************************
 * ۱. تنظیمات اتصال و متغیرهای اصلی
 ************************************************/
var SUPABASE_URL = 'https://kqnsbnpznkwkwukzokik.supabase.co';
var SUPABASE_KEY = 'sb_publishable_ZqXeccdaSzZUivCwU38WcQ_m05uT4y6';
var supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    const userId = localStorage.getItem('user_id');
    const myPoolId = localStorage.getItem('pool_id');
    const userName = localStorage.getItem('user_name');

    // لایه امنیتی لاگین
    if (!userId || !myPoolId) {
        window.location.replace('login.html');
        return;
    }

    // نمایش نام در هدر
    const headerName = document.getElementById('user-name-display');
    if (headerName) headerName.innerText = userName;

    // بارگذاری داده‌ها
    await loadUserFinancials(userId, myPoolId);
    calculateMyTotalDeposits(userId, myPoolId);
    calculateUserTotalProfit(userId, myPoolId);
    loadLastWinner(myPoolId);
    loadMyTransactions(userId, myPoolId);
    loadActiveLoans(userId, myPoolId);
    checkMonthlyReminder(userId, myPoolId);
    loadManagerContact(myPoolId);

    // لینک کردن کاربر به OneSignal
    if (typeof OneSignal !== 'undefined') {
        OneSignal.login(userId);
    }

    // حذف Splash Screen
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.remove();
                document.body.classList.remove('loading');
            }, 700);
        }
    }, 2500);
});

/************************************************
 * ۲. مدیریت زیرمنو (جابجایی و انیمیشن)
 ************************************************/
function showSec(btn, id) {
    if (window.navigator.vibrate) window.navigator.vibrate(10);
    ['home-sec', 'trans-sec', 'loan-sec'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        item.style.color = '#94a3b8';
    });
    btn.classList.add('active');
    btn.style.color = '#10b981';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/************************************************
 * ۳. محاسبات مالی هوشمند
 ************************************************/
async function loadUserFinancials(userId, poolId) {
    try {
        const { data: settings } = await supabaseClient.from('settings').select('*').eq('pool_id', poolId).maybeSingle();
        const basePrice = settings ? Number(settings.base_amount) : 2000000;
        const wonPrice = settings ? Number(settings.won_amount) : 2500000;

        const { data: user } = await supabaseClient.from('members').select('*').eq('id', userId).single();
        if (user) {
            const won = user.won_shares || 0;
            const active = (user.total_shares || 1) - won;
            const finalAmt = (won * wonPrice) + (active * basePrice);

            document.getElementById('amount-display').innerText = finalAmt.toLocaleString() + ' تومان';
            document.getElementById('status-badge').innerText = `وضعیت: ${user.total_shares} سهم (${won} برنده)`;
        }
    } catch (e) { console.error(e); }
}

async function calculateMyTotalDeposits(userId, poolId) {
    const { data } = await supabaseClient.from('transactions').select('amount').eq('member_id', userId).eq('pool_id', poolId).eq('status', 'approved').eq('type', 'in');
    const total = data ? data.reduce((s, i) => s + Number(i.amount), 0) : 0;
    const el = document.getElementById('user-total-balance');
    if (el) el.innerText = total.toLocaleString() + ' تومان';
}

async function calculateUserTotalProfit(userId, poolId) {
    const { data } = await supabaseClient.from('transactions').select('amount').eq('member_id', userId).eq('pool_id', poolId).eq('status', 'approved').eq('receipt_url', 'سود پروژه');
    const total = data ? data.reduce((s, i) => s + Number(i.amount), 0) : 0;
    const el = document.getElementById('user-total-profit');
    if (el) el.innerText = total.toLocaleString() + ' ت';
}

/************************************************
 * ۴. تراکنش‌ها و آپلود فیش
 ************************************************/
async function uploadReceipt() {
    const fileInput = document.getElementById('receipt-input');
    const amountInput = document.getElementById('receipt-amount-input');
    const userId = localStorage.getItem('user_id');
    const poolId = localStorage.getItem('pool_id');
    const userName = localStorage.getItem('user_name');

    if (!fileInput.files[0] || !amountInput.value) return alert("فیش و مبلغ را وارد کنید ❌");

    const btn = document.getElementById('upload-btn');
    btn.disabled = true; btn.innerText = "در حال ارسال...";

    try {
        const file = fileInput.files[0];
        const fileName = `${poolId}-${userId}-${Date.now()}.jpg`;
        await supabaseClient.storage.from('receipts').upload(fileName, file);
        const { data: urlData } = supabaseClient.storage.from('receipts').getPublicUrl(fileName);

        const { error: insertErr } = await supabaseClient.from('transactions').insert([{
            member_id: userId, pool_id: poolId, amount: Number(amountInput.value),
            status: 'pending', type: 'in', receipt_url: urlData.publicUrl
        }]);

        if (insertErr) throw insertErr;

        alert("فیش با موفقیت ارسال شد ✅");
        notifyManager("فیش جدید رسید 📄", `عضو ${userName} یک فیش جدید ارسال کرد.`, poolId);
        location.reload();
    } catch (err) {
        alert("خطا: " + err.message);
        btn.disabled = false; btn.innerText = "تایید و ارسال نهایی";
    }
}

async function loadMyTransactions(userId, poolId) {
    const { data } = await supabaseClient.from('transactions').select('*').eq('member_id', userId).eq('pool_id', poolId).order('created_at', { ascending: false });
    const container = document.getElementById('user-transactions');
    if (data && container) {
        container.innerHTML = data.map(t => {
            const date = new Date(t.created_at).toLocaleDateString('fa-IR');
            return `<div class="bg-white p-4 rounded-3xl border mb-3 flex justify-between items-center shadow-sm">
                <div class="text-right">
                    <p class="text-xs font-black">${Number(t.amount).toLocaleString()} ت</p>
                    <p class="text-[8px] text-gray-400">${t.type === 'out' ? '↓ برداشت' : '↑ واریز'} - ${date}</p>
                </div>
                <span class="text-[9px] font-bold ${t.status === 'approved' ? 'text-emerald-600' : 'text-orange-500'}">${t.status === 'approved' ? 'تایید شد' : 'منتظر'}</span>
            </div>`;
        }).join('');
    }
}

/************************************************
 * ۵. سیستم وام و رای‌گیری
 ************************************************/
async function submitLoanRequest() {
    const amt = document.getElementById('loan-amount').value;
    const desc = document.getElementById('loan-desc').value;
    const poolId = localStorage.getItem('pool_id');
    const userName = localStorage.getItem('user_name');
    if(!amt) return alert("مبلغ را وارد کنید");

    const { error } = await supabaseClient.from('loans').insert([{ pool_id: poolId, requester_name: userName, amount: Number(amt), description: desc, status: 'voting' }]);
    if (!error) {
        alert("درخواست ثبت شد ✅");
        notifyManager("درخواست وام 💰", `${userName} درخواست وام ثبت کرد.`, poolId);
        location.reload();
    }
}

async function loadActiveLoans(userId, poolId) {
    const { data: loans } = await supabaseClient.from('loans').select('*').eq('pool_id', poolId).eq('status', 'voting');
    const { data: myVotes } = await supabaseClient.from('loan_votes').select('loan_id').eq('user_id', userId);
    const votedIds = myVotes ? myVotes.map(v => v.loan_id) : [];
    const container = document.getElementById('loan-list-container');
    if (loans && container) {
        container.innerHTML = loans.map(l => {
            const hasVoted = votedIds.includes(l.id);
            return `<div class="bg-white p-5 rounded-[2rem] border border-blue-50 mb-4 shadow-sm text-right">
                <p class="text-[11px] font-black text-slate-800">${l.requester_name} | وام: ${Number(l.amount).toLocaleString()} ت</p>
                <p class="text-[10px] text-gray-500 my-3 leading-relaxed italic">"${l.description}"</p>
                <div class="flex gap-2">
                    <button onclick="vote(${l.id}, 'up')" class="flex-1 bg-emerald-50 text-emerald-600 py-3 rounded-2xl font-bold text-[10px] ${hasVoted ? 'opacity-30 pointer-events-none' : ''}">موافقم (${l.votes_up || 0})</button>
                    <button onclick="vote(${l.id}, 'down')" class="flex-1 bg-rose-50 text-rose-500 py-3 rounded-2xl font-bold text-[10px] ${hasVoted ? 'opacity-30 pointer-events-none' : ''}">مخالفم (${l.votes_down || 0})</button>
                </div>
            </div>`;
        }).join('');
    }
}

async function vote(id, type) {
    const userId = localStorage.getItem('user_id');
    const poolId = localStorage.getItem('pool_id');
    const { error: vErr } = await supabaseClient.from('loan_votes').insert([{ loan_id: id, user_id: userId, pool_id: poolId }]);
    if (vErr) return alert("قبلاً رای داده‌اید");
    const { data: l } = await supabaseClient.from('loans').select('*').eq('id', id).single();
    let up = l.votes_up || 0, down = l.votes_down || 0;
    if (type === 'up') up++; else down++;
    await supabaseClient.from('loans').update({ votes_up: up, votes_down: down }).eq('id', id);
    loadActiveLoans(userId, poolId);
}

/************************************************
 * ۶. نوتیفیکیشن، تماس و امنیت
 ************************************************/
async function notifyManager(title, message, poolId) {
    const APP_ID = "6235857d-565c-4223-bffa-af420f2cd45b"; 
    const API_KEY = "os_v2_app_mi2yk7kwlrbchp72v5ba6lgulm3yudga3sbeet5dt2feqhyer27faufsiea2acnuio5vcmebonhdyyw5vqqo6zfqc3i3gnyw6";
    try {
        await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Basic " + API_KEY },
            body: JSON.stringify({
                app_id: APP_ID,
                filters: [{ "field": "tag", "key": "role", "relation": "=", "value": "admin" }, { "operator": "AND" }, { "field": "tag", "key": "pool_id", "relation": "=", "value": String(poolId) }],
                headings: { "fa": title }, contents: { "fa": message }
            })
        });
    } catch (e) { console.error(e); }
}

async function loadLastWinner(poolId) {
    const { data } = await supabaseClient.from('lottery_results').select('winner_name').eq('pool_id', poolId).order('draw_date', { ascending: false }).limit(1);
    if (data && data[0]) document.getElementById('lucky-winner').innerText = data[0].winner_name;
}

async function loadManagerContact(poolId) {
    const { data } = await supabaseClient.from('members').select('mobile').eq('pool_id', poolId).eq('is_admin', true).limit(1).maybeSingle();
    if (data && data.mobile) {
        let phone = data.mobile;
        if (phone.startsWith('0')) phone = '98' + phone.substring(1);
        const link = document.getElementById('manager-wa-link');
        if (link) link.href = `https://wa.me/${phone}`;
    }
}

async function checkMonthlyReminder(userId, poolId) {
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { data } = await supabaseClient.from('transactions').select('*').eq('member_id', userId).eq('pool_id', poolId).eq('status', 'approved').eq('type', 'in').gte('created_at', firstDay);
    if (!data || data.length === 0) {
        const banner = document.createElement('div');
        banner.className = 'bg-rose-600 text-white p-3 text-[9px] text-center font-bold sticky top-0 z-[200] animate-pulse';
        banner.innerHTML = `🔔 واریز قسط این ماه فراموش نشود! <button onclick="this.parentElement.remove()" class="mr-2 opacity-50 font-black">✕</button>`;
        document.body.prepend(banner);
    }
}

function handleLogout() { if (confirm("خروج؟")) { localStorage.clear(); window.location.replace('login.html'); } }

// تمدید و تنظیمات رمز
function openPassModal() { document.getElementById('pass-modal').classList.remove('hidden'); }
function closePassModal() { document.getElementById('pass-modal').classList.add('hidden'); }
async function submitNewPassword() {
    const currentPass = document.getElementById('current-password').value;
    const newPass = document.getElementById('new-password').value;
    const userId = localStorage.getItem('user_id');
    const { data: user } = await supabaseClient.from('members').select('password').eq('id', userId).single();
    if (user.password !== currentPass) return alert("رمز فعلی غلط است");
    await supabaseClient.from('members').update({ password: newPass }).eq('id', userId);
    alert("تغییر یافت ✅"); closePassModal();
}