/************************************************
 * ۱. تنظیمات اتصال و متغیرهای اصلی
 ************************************************/
var SUPABASE_URL = 'https://kqnsbnpznkwkwukzokik.supabase.co';
var SUPABASE_KEY = 'sb_publishable_ZqXeccdaSzZUivCwU38WcQ_m05uT4y6';
var supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);


document.addEventListener('DOMContentLoaded', () => {
    // اضافه کردن کلاس لودینگ به بادی
    document.body.classList.add('loading');

    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.style.opacity = '0'; // افکت محو شدن
            setTimeout(() => {
                splash.remove(); // حذف کامل از صفحه
                document.body.classList.remove('loading');
            }, 700);
        }
    }, 3000); // مدت زمان نمایش لوگو (۲.۵ ثانیه)
});

document.addEventListener('DOMContentLoaded', async () => {
    const userId = localStorage.getItem('user_id');
    const myPoolId = localStorage.getItem('pool_id');
    const userName = localStorage.getItem('user_name');

    if (!userId || !myPoolId) {
        window.location.replace('login.html');
        return;
    }
    
    async function calculateUserTotalProfit(userId, poolId) {
    try {
        // سودها در تراکنش‌های نوع 'in' با متنی مثل 'سود' در آدرس فیش ذخیره می‌شوند
        const { data } = await supabaseClient
            .from('transactions')
            .select('amount')
            .eq('member_id', userId)
            .eq('pool_id', poolId)
            .eq('status', 'approved')
            .eq('receipt_url', 'سود پروژه'); // یا هر متنی که موقع توزیع سود نوشتی

        const totalProfit = data ? data.reduce((s, i) => s + Number(i.amount), 0) : 0;
        const profitEl = document.getElementById('user-total-profit');
        if (profitEl) profitEl.innerText = totalProfit.toLocaleString() + ' ت';
    } catch (e) { console.log("Profit calculation error"); }
}

    // نمایش نام در هدر
    const headerName = document.getElementById('user-name-display');
    if (headerName) headerName.innerText = userName;

    // بارگذاری زنجیره‌ای داده‌ها
    await loadUserFinancials(userId, myPoolId);
    calculateMyTotalDeposits(userId, myPoolId);
    loadLastWinner(myPoolId);
    loadMyTransactions(userId, myPoolId);
    loadActiveLoans(userId, myPoolId);
    checkMonthlyReminder(userId, myPoolId);
    if (typeof loadManagerContact === 'function') loadManagerContact(myPoolId);
    
    // در فایل app.js بعد از گرفتن userId
if (userId && typeof OneSignal !== 'undefined') {
    OneSignal.login(userId); // لینک کردن گوشی عضو به آیدی دیتابیس
}
});

/************************************************
 * ۲. مدیریت زیرمنو (رنگی شدن و جابجایی)
 ************************************************/
function showSec(btn, id) {
    // مخفی کردن سکشن‌ها
    ['home-sec', 'trans-sec', 'loan-sec'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.add('hidden');
    });
    
    // نمایش سکشن انتخابی
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');

    // مدیریت رنگ دکمه‌ها
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active', 'text-emerald-600');
        item.classList.add('text-gray-400');
    });

    btn.classList.add('active', 'text-emerald-600');
    btn.classList.remove('text-gray-400');
    
    // لرزش خفیف موبایل
    if (window.navigator.vibrate) window.navigator.vibrate(10);
}

/************************************************
 * ۳. محاسبات مالی هوشمند (چندسهمی)
 ************************************************/
async function loadUserFinancials(userId, poolId) {
    try {
        const { data: settings } = await supabaseClient.from('settings').select('*').eq('pool_id', poolId).maybeSingle();
        const basePrice = settings ? Number(settings.base_amount) : 2000000;
        const wonPrice = settings ? Number(settings.won_amount) : 2500000;

        const { data: user } = await supabaseClient.from('members').select('*').eq('id', userId).single();
        if (user) {
            const total = user.total_shares || 1;
            const won = user.won_shares || 0;
            const active = total - won;
            const finalAmt = (won * wonPrice) + (active * basePrice);

            document.getElementById('amount-display').innerText = finalAmt.toLocaleString() + ' تومان';
            document.getElementById('status-badge').innerText = `وضعیت: ${total} سهم (${won} برنده)`;
            
            // نمایش امتیاز و سود اگر المان‌ها باشند
            if (document.getElementById('user-score')) document.getElementById('user-score').innerText = user.credit_score || 100;
        }
    } catch (e) { console.error("Load Financials Error:", e); }
}

/************************************************
 * ۴. ثبت واریزی و حل مشکل dbErr
 ************************************************/
async function uploadReceipt() {
    const fileInput = document.getElementById('receipt-input');
    const amountInput = document.getElementById('receipt-amount-input');
    const userId = localStorage.getItem('user_id');
    const poolId = localStorage.getItem('pool_id');

    if (!fileInput.files[0] || !amountInput.value) {
        alert("لطفاً فیش را انتخاب و مبلغ را وارد کنید ❌");
        return;
    }

    const btn = document.getElementById('upload-btn');
    btn.disabled = true; btn.innerText = "در حال ارسال...";

    try {
        const file = fileInput.files[0];
        const fileName = `${poolId}-${userId}-${Date.now()}.jpg`;

        // ۱. آپلود در استوریج
        const { error: upErr } = await supabaseClient.storage.from('receipts').upload(fileName, file);
        if (upErr) throw upErr;

        const { data: urlData } = supabaseClient.storage.from('receipts').getPublicUrl(fileName);

        // ۲. ثبت در دیتابیس (نام متغیر را ساده گذاشتیم تا خطا ندهد)
        const { error: insertErr } = await supabaseClient.from('transactions').insert([{
            member_id: userId,
            pool_id: poolId,
            amount: Number(amountInput.value),
            status: 'pending',
            type: 'in',
            receipt_url: urlData.publicUrl
        }]);

        if (insertErr) throw insertErr;

        alert("فیش با موفقیت ارسال شد ✅");
        location.reload();

    } catch (err) {
        alert("خطا در ارسال: " + err.message);
        btn.disabled = false; btn.innerText = "تایید و ارسال نهایی";
    }
}

/************************************************
 * ۵. سایر توابع (تراکنش، وام، نوتیفیکیشن)
 ************************************************/
async function calculateMyTotalDeposits(userId, poolId) {
    const { data } = await supabaseClient.from('transactions').select('amount').eq('member_id', userId).eq('pool_id', poolId).eq('status', 'approved').eq('type', 'in');
    const total = data ? data.reduce((s, i) => s + Number(i.amount), 0) : 0;
    const totalEl = document.getElementById('user-total-balance');
    if (totalEl) totalEl.innerText = total.toLocaleString() + ' تومان';
}

async function loadLastWinner(poolId) {
    const { data } = await supabaseClient.from('lottery_results').select('winner_name').eq('pool_id', poolId).order('draw_date', { ascending: false }).limit(1);
    if (data && data[0]) document.getElementById('lucky-winner').innerText = data[0].winner_name;
}

async function loadMyTransactions(userId, poolId) {
    const { data } = await supabaseClient.from('transactions').select('*').eq('member_id', userId).eq('pool_id', poolId).order('created_at', { ascending: false });
    const container = document.getElementById('user-transactions');
    if (data && container) {
        container.innerHTML = data.map(t => {
            const date = new Date(t.created_at).toLocaleDateString('fa-IR');
            const isApproved = t.status === 'approved';
            return `
                <div class="bg-white p-4 rounded-[2rem] border mb-3 flex justify-between items-center shadow-sm">
                    <div class="text-right">
                        <p class="text-xs font-black">${Number(t.amount).toLocaleString()} ت</p>
                        <p class="text-[8px] text-gray-400">${date}</p>
                    </div>
                    <span class="text-[9px] font-bold ${isApproved ? 'text-emerald-600' : 'text-orange-500'}">${isApproved ? 'تایید شده' : 'در انتظار'}</span>
                </div>`;
        }).join('');
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
            return `
                <div class="bg-white p-5 rounded-[2rem] border mb-3 text-[10px] shadow-sm">
                    <p class="font-black text-slate-800">${l.requester_name} | وام: ${Number(l.amount).toLocaleString()} ت</p>
                    <p class="text-gray-500 my-2 italic">"${l.description}"</p>
                    <div class="flex gap-2">
                        <button onclick="vote(${l.id}, 'up')" class="flex-1 bg-emerald-50 text-emerald-600 py-3 rounded-2xl font-bold ${hasVoted ? 'opacity-30 pointer-events-none' : ''}">موافق (${l.votes_up || 0})</button>
                        <button onclick="vote(${l.id}, 'down')" class="flex-1 bg-rose-50 text-rose-600 py-3 rounded-2xl font-bold ${hasVoted ? 'opacity-30 pointer-events-none' : ''}">مخالف (${l.votes_down || 0})</button>
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

    const { data: loan } = await supabaseClient.from('loans').select('*').eq('id', id).single();
    let up = loan.votes_up || 0, down = loan.votes_down || 0;
    if (type === 'up') up++; else down++;
    await supabaseClient.from('loans').update({ votes_up: up, votes_down: down }).eq('id', id);
    loadActiveLoans(userId, poolId);
}

async function submitLoanRequest() {
    const amt = document.getElementById('loan-amount').value;
    const desc = document.getElementById('loan-desc').value;
    const poolId = localStorage.getItem('pool_id');
    const name = localStorage.getItem('user_name');
    if(!amt) return alert("مبلغ را وارد کنید");
    await supabaseClient.from('loans').insert([{ pool_id: poolId, requester_name: name, amount: Number(amt), description: desc, status: 'voting' }]);
    alert("درخواست ثبت شد ✅"); location.reload();
}

async function checkMonthlyReminder(userId, poolId) {
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { data } = await supabaseClient.from('transactions').select('*').eq('member_id', userId).eq('pool_id', poolId).eq('status', 'approved').eq('type', 'in').gte('created_at', firstDay);
    if (!data || data.length === 0) {
        const banner = document.createElement('div');
        banner.className = 'bg-rose-600 text-white p-3 text-[9px] text-center font-bold sticky top-0 z-[200] animate-pulse';
        banner.innerHTML = `🔔 هم‌صندوقی عزیز، واریز قسط این ماه فراموش نشود! <button onclick="this.parentElement.remove()" class="mr-2 opacity-50 font-black text-xs">✕</button>`;
        document.body.prepend(banner);
    }
}

async function loadManagerContact(poolId) {
    const { data } = await supabaseClient.from('members').select('mobile').eq('pool_id', poolId).eq('is_admin', true).limit(1).maybeSingle();
    if (data && data.mobile) {
        let phone = data.mobile;
        if (phone.startsWith('0')) phone = '98' + phone.substring(1);
        const waLink = document.getElementById('manager-wa-link');
        if (waLink) waLink.href = `https://wa.me/${phone}`;
    }
}

function handleLogout() {
    if (confirm("خروج از حساب؟")) {
        localStorage.clear();
        window.location.replace('login.html');
    }
}


// باز و بسته کردن مودال
function openPassModal() { document.getElementById('pass-modal').classList.remove('hidden'); }
function closePassModal() { 
    document.getElementById('pass-modal').classList.add('hidden');
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
}

// تابع اصلی تغییر رمز
async function submitNewPassword() {
    const currentPass = document.getElementById('current-password').value;
    const newPass = document.getElementById('new-password').value;
    const userId = localStorage.getItem('user_id');
    const btn = document.getElementById('change-pass-btn');

    if (!currentPass || !newPass) return alert("لطفاً تمام کادرها را پر کنید ❌");
    if (newPass.length < 4) return alert("رمز جدید باید حداقل ۴ کاراکتر باشد");

    btn.disabled = true; btn.innerText = "در حال بررسی...";

    try {
        // ۱. بررسی صحت رمز فعلی
        const { data: user, error: fetchErr } = await supabaseClient
            .from('members')
            .select('password')
            .eq('id', userId)
            .single();

        if (user.password !== currentPass) {
            alert("رمز فعلی شما اشتباه است ❌");
            btn.disabled = false; btn.innerText = "ذخیره رمز جدید";
            return;
        }

        // ۲. آپدیت رمز جدید در دیتابیس
        const { error: updateErr } = await supabaseClient
            .from('members')
            .update({ password: newPass })
            .eq('id', userId);

        if (updateErr) throw updateErr;

        alert("✅ رمز عبور با موفقیت تغییر کرد.");
        closePassModal();
        
    } catch (e) {
        alert("خطا در تغییر رمز: " + e.message);
    } finally {
        btn.disabled = false; btn.innerText = "ذخیره رمز جدید";
    }
}
