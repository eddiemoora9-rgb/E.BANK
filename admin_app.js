/************************************************
 * ۱. تنظیمات اتصال و متغیرهای سراسری
 ************************************************/
var SUPABASE_URL = 'https://kqnsbnpznkwkwukzokik.supabase.co';
var SUPABASE_KEY = 'sb_publishable_ZqXeccdaSzZUivCwU38WcQ_m05uT4y6';
var supabaseClient = null;

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


// تابع راه‌اندازی اتصال (ضد کرش)
function initSupabase() {
    if (typeof supabase !== 'undefined' && !supabaseClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        return true;
    }
    return !!supabaseClient;
}

var allMembersData = [];
var selectedMemberForReport = null;

/************************************************
 * ۲. موتور اصلی برنامه (DOMContentLoaded)
 ************************************************/
document.addEventListener('DOMContentLoaded', async () => {
    // ۱. بررسی لود شدن کتابخانه دیتابیس
    if (!initSupabase()) {
        console.log("در حال انتظار برای کتابخانه...");
        setTimeout(() => location.reload(), 1500);
        return;
    }

    // ۲. دریافت اطلاعات از حافظه گوشی
    const isAdmin = localStorage.getItem('is_admin');
    const myPoolId = localStorage.getItem('pool_id');
    const userId = localStorage.getItem('user_id');

    // ۳. بررسی لاگین بودن مدیر
    if (isAdmin !== 'true' || !myPoolId) {
        window.location.replace('login.html');
        return;
    }

    // ۴. بررسی وضعیت اشتراک، تاریخ انقضا و ظرفیت سهمیه
    try {
        const { data: pool, error } = await supabaseClient
            .from('pools')
            .select('*')
            .eq('id', myPoolId)
            .maybeSingle();

        if (error) throw error;

        if (pool) {
            const now = new Date();
            const expiry = new Date(pool.sub_expiry);
            const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

            // بررسی قفل بودن حساب
            if (pool.is_active === false || diffDays <= 0) {
                showLockPage(); 
                return;
            }

            // نمایش اطلاعات در داشبورد
            const daysDisplay = document.getElementById('sub-days-display');
            const dateDisplay = document.getElementById('sub-date-display');
            if (daysDisplay) daysDisplay.innerText = diffDays + " روز باقی‌مانده";
            if (dateDisplay) dateDisplay.innerText = "انقضا: " + expiry.toLocaleDateString('fa-IR');

            // نمایش سهمیه باقی‌مانده
            const capElements = document.querySelectorAll('#member-capacity-display');
            capElements.forEach(el => {
                el.innerText = (pool.member_capacity || 0) + " سهمیه";
            });
        }
    } catch (err) { 
        console.error("خطا در امنیت:", err.message); 
    }

    // ۵. بارگذاری تمام اطلاعات داشبورد
    loadPendingReceipts(myPoolId);
    loadAllMembers(myPoolId);
    calculateStats(myPoolId);
    loadCurrentConfig(myPoolId);
    loadAdminLoans(myPoolId);
    loadAdminProjects(myPoolId);

    // ۶. اجرای ابزارهای سیستمی
    injectSuperAdminButton(userId);
    initSecretClick();
    updateReceiptBadge(myPoolId);
    initOneSignalAdmin(myPoolId);
});

/************************************************
 * ۳. مدیریت جابجایی بین صفحات (Navigation)
 ************************************************/
function showAdminSec(btn, id) {
    const sections = ['admin-home-sec', 'admin-verify-sec', 'admin-loans-verify-sec', 'admin-projects-sec', 'admin-members-sec', 'admin-settings-sec'];
    sections.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('text-indigo-400');
        b.classList.add('text-slate-500');
    });
    btn.classList.add('text-indigo-400');
    btn.classList.remove('text-slate-500');
}

/************************************************
 * ۴. حسابداری پیشرفته (۳ صندوق)
 ***************************************
 
  /************************************************
 * تابع حسابداری مرکزی (مدیریت ۳ صندوق مجزا)
 ************************************************/
async function calculateStats(poolId) {
    try {
        // ۱. دریافت تنظیمات درصد سرمایه‌گذاری
        const { data: set } = await supabaseClient.from('settings').select('investment_percent').eq('pool_id', poolId).maybeSingle();
        const N = set ? Number(set.investment_percent) : 0;

        // ۲. دریافت تمام تراکنش‌های تایید شده
        const { data: txs, error } = await supabaseClient
            .from('transactions')
            .select('amount, type, invest_val')
            .eq('pool_id', poolId)
            .eq('status', 'approved');

        if (error) throw error;

        if (txs) {
            let totalIn = 0;            // واریزی اعضا
            let totalOut = 0;           // پرداختی وام/برنده
            let totalInvestTarget = 0;  // سهمیه‌های کسر شده برای سرمایه
            let actualCapitalSpent = 0; // پول خرج شده برای خرید پروژه
            let totalProfitIn = 0;      // سودهای دریافتی
            let totalProfitDist = 0;    // سودهای تقسیم شده

            txs.forEach(t => {
                const val = Number(t.amount || 0);
                const inv = Number(t.invest_val || 0);
                totalInvestTarget += inv;

                if (t.type === 'in') totalIn += val;
                else if (t.type === 'out') totalOut += val;
                else if (t.type === 'capital_spend') actualCapitalSpent += val;
                else if (t.type === 'profit') totalProfitIn += val;
                else if (t.type === 'distribution') totalProfitDist += val;
            });

            // --- محاسبات ۳ صندوق مجزا ---
            const mainFund = (totalIn - totalInvestTarget) - totalOut; // موجودی نقد وام
            const investFund = totalInvestTarget - actualCapitalSpent; // موجودی صندوق سرمایه
            const profitFund = totalProfitIn - totalProfitDist;        // موجودی سود انباشته

            // --- محاسبه دارایی کل (ارزش نهایی) ---
            // دارایی کل = موجودی نقد + موجودی سرمایه + موجودی سود
            const totalAssets = mainFund + investFund + profitFund;

            // ۳. نمایش در رابط کاربری
            const elMaster = document.getElementById('master-total-assets');
            const elMain = document.getElementById('main-fund-balance');
            const elInvest = document.getElementById('invest-fund-balance');
            const elProfit = document.getElementById('profit-fund-balance');

            if (elMaster) elMaster.innerText = Math.floor(totalAssets).toLocaleString() + " تومان";
            if (elMain) elMain.innerText = Math.floor(mainFund).toLocaleString() + " تومان";
            if (elInvest) elInvest.innerText = Math.floor(investFund).toLocaleString();
            if (elProfit) elProfit.innerText = Math.floor(profitFund).toLocaleString();

            console.log("💎 دارایی کل محاسبه شد:", totalAssets);
        }
    } catch (err) {
        console.error("خطا در محاسبه تراز مالی:", err.message);
    }
}
/************************************************
 * 
 * 
 * /************************************************
 * تابع نمایش لیست اعضا (اصلاح شده و نهایی)
 ************************************************/
async function loadAllMembers(poolId) {
    try {
        // ۱. دریافت لیست اعضا از دیتابیس (مرتب شده بر اساس امتیاز خوش‌حسابی)
        const { data: members, error: memErr } = await supabaseClient
            .from('members')
            .select('*')
            .eq('pool_id', poolId)
            .order('credit_score', { ascending: false });

        if (memErr) throw memErr;

        // ۲. دریافت تمام تراکنش‌های تایید شده برای محاسبه جمع واریزی هر نفر
        const { data: txs, error: txErr } = await supabaseClient
            .from('transactions')
            .select('member_id, amount, type')
            .eq('pool_id', poolId)
            .eq('status', 'approved');

        if (txErr) throw txErr;

        // ذخیره در متغیر سراسری برای استفاده در مودال‌ها
        allMembersData = members || [];

        const container = document.getElementById('members-list');
        if (!container) return;

        if (!members || members.length === 0) {
            container.innerHTML = '<p class="text-center text-[10px] text-slate-400 py-10 font-bold tracking-widest">هیچ عضوی یافت نشد</p>';
            return;
        }

        // ۳. ساخت لیست اعضا با ظاهر مدرن
        container.innerHTML = members.map(m => {
            // محاسبه مجموع واریزی‌های این شخص
            const userIn = txs ? txs.filter(t => t.member_id === m.id && t.type === 'in').reduce((s, a) => s + Number(a.amount), 0) : 0;

            return `
                <div class="bg-white p-4 rounded-[2rem] border border-slate-50 flex justify-between items-center mb-3 shadow-sm">
                    <div class="text-right">
                        <p class="text-[11px] font-black text-slate-800">${m.full_name}</p>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-[8px] text-amber-500 font-black flex items-center gap-1">
                                <i class="fas fa-star text-[7px]"></i> ${m.credit_score || 100}%
                            </span>
                            <span class="text-[8px] text-emerald-600 font-bold font-black">واریزی: ${userIn.toLocaleString()} ت</span>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <!-- دکمه گزارش -->
                        <button onclick="openReportModalById(${m.id})" class="w-10 h-10 bg-slate-900 text-white rounded-2xl flex items-center justify-center active:scale-90 shadow-lg">
                            <i class="fas fa-chart-line text-xs"></i>
                        </button>
                        <!-- دکمه ویرایش -->
                        <button onclick="openEditModalById(${m.id})" class="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center active:scale-90">
                            <i class="fas fa-edit text-xs"></i>
                        </button>
                    </div>
                </div>`;
        }).join('');

    } catch (err) {
        console.error("خطا در لود اعضا:", err.message);
    }
}
 // ۵. مدیریت اعضا (لیست، گزارش، حذف)


async function openReportModalById(id) {
    const m = allMembersData.find(x => x.id === id);
    if (!m) return;
    selectedMemberForReport = m;
    document.getElementById('rep-name').innerText = m.full_name;
    document.getElementById('rep-mobile').innerText = m.mobile;
    document.getElementById('rep-score').innerText = m.credit_score || 100;

    const { data: txs } = await supabaseClient.from('transactions').select('*').eq('member_id', m.id).eq('status', 'approved');
    let tin = txs ? txs.filter(t => t.type === 'in').reduce((s, a) => s + Number(a.amount), 0) : 0;

    const debt = Number(m.debt_target || 0);
    const remain = Math.max(0, debt - tin);
    const progress = debt > 0 ? Math.min(Math.floor((tin / debt) * 100), 100) : 0;

    document.getElementById('rep-total-in').innerText = tin.toLocaleString() + " ت";
    document.getElementById('rep-total-out').innerText = debt.toLocaleString() + " ت";
    document.getElementById('rep-balance').innerText = remain.toLocaleString() + " تومان مانده بدهی";
    document.getElementById('report-modal').classList.remove('hidden');
}

async function handleDeleteWithSettlement() {
    const m = selectedMemberForReport;
    const amt = Number(document.getElementById('settle-amount').value);
    if (!confirm(`حذف نهایی "${m.full_name}"؟`)) return;
    try {
        if (amt > 0) {
            await supabaseClient.from('transactions').insert([{ pool_id: m.pool_id, amount: amt, status: 'approved', type: 'out', receipt_url: 'تسویه نهایی عضو' }]);
        }
        await supabaseClient.from('members').delete().eq('id', m.id);
        alert("انجام شد ✅"); location.reload();
    } catch (e) { alert("خطا در حذف عضو"); }
}

/************************************************
 * ۶. مدیریت قرعه‌کشی، وام و پروژه‌ها
 ************************************************/
async function runLottery() {
    const poolId = localStorage.getItem('pool_id');
    const { data: members } = await supabaseClient.from('members').select('*').eq('pool_id', poolId);
    let hat = [];
    members.forEach(m => {
        let rem = (m.total_shares || 1) - (m.won_shares || 0);
        for(let i=0; i<rem; i++) hat.push(m);
    });

    if (hat.length === 0) return alert("همه سهم‌ها برنده شده‌اند!");
    const winner = hat[Math.floor(Math.random() * hat.length)];
    let amt = prompt(`🏆 برنده: ${winner.full_name}\nچه مبلغی از گاوصندوق کسر شود؟`, "80000000");
    if (!amt) return;

    try {
        await supabaseClient.from('lottery_results').insert([{ pool_id: poolId, winner_name: winner.full_name, month_name: 'دی' }]);
        await supabaseClient.from('transactions').insert([{ pool_id: poolId, member_id: winner.id, amount: Number(amt), status: 'approved', type: 'out', receipt_url: 'پرداخت قرعه‌کشی' }]);

        let newWon = (winner.won_shares || 0) + 1;
        await supabaseClient.from('members').update({ won_shares: newWon, has_won: newWon >= winner.total_shares, debt_target: (Number(winner.debt_target) || 0) + Number(amt) }).eq('id', winner.id);
        alert("انجام شد ✅"); location.reload();
    } catch (e) { alert("خطا در ثبت قرعه‌کشی"); }
}


/************************************************
 * نمایش لیست وام‌ها برای مدیر همراه با آمار آراء
 ************************************************/
async function loadAdminLoans(poolId) {
    try {
        const { data: loans, error } = await supabaseClient
            .from('loans')
            .select('*')
            .eq('pool_id', poolId)
            .order('created_at', { ascending: false });

        const container = document.getElementById('admin-loans-list');
        if (!container) return;

        if (error || !loans || loans.length === 0) {
            container.innerHTML = '<p class="text-center text-[10px] text-slate-400 py-10 font-bold uppercase tracking-widest">No Loan Requests</p>';
            return;
        }

        container.innerHTML = loans.map(l => {
            const isPaid = l.status === 'paid';
            const btnClass = isPaid ? "bg-slate-100 text-slate-400 pointer-events-none" : "bg-indigo-600 text-white shadow-lg active:scale-95";
            const btnText = isPaid ? "واریز شده" : "تایید و کسر";

            return `
                <div class="bg-white p-5 rounded-[2rem] border border-slate-100 flex justify-between items-center mb-4 shadow-sm text-right relative overflow-hidden">
                    <div class="flex-1">
                        <!-- نام درخواست دهنده و مبلغ -->
                        <p class="text-[11px] font-black text-slate-800">${l.requester_name}</p>
                        <p class="text-[9px] text-slate-500 font-bold mb-3">${Number(l.amount).toLocaleString()} تومان</p>
                        
                        <!-- نمایش آمار موافقان و مخالفان 👇 -->
                        <div class="flex gap-2">
                            <div class="flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                                <i class="fas fa-thumbs-up text-[8px] text-emerald-600"></i>
                                <span class="text-[9px] font-black text-emerald-700">${l.votes_up || 0} موافق</span>
                            </div>
                            <div class="flex items-center gap-1 bg-rose-50 px-2 py-1 rounded-lg border border-rose-100">
                                <i class="fas fa-thumbs-down text-[8px] text-rose-600"></i>
                                <span class="text-[9px] font-black text-rose-700">${l.votes_down || 0} مخالف</span>
                            </div>
                        </div>
                    </div>

                    <!-- دکمه عملیاتی پرداخت -->
                    <div class="mr-4">
                        <button onclick="payLoan(${l.id}, ${l.amount}, '${l.requester_name}')" 
                                class="px-5 py-3 rounded-2xl font-black text-[9px] transition-all ${btnClass}">
                            ${btnText}
                        </button>
                    </div>
                </div>`;
        }).join('');
    } catch (err) {
        console.error("Error loading admin loans:", err);
    }
}


async function payLoan(id, amt, name) {
    let finalPay = prompt(`مبلغ واریزی برای وام ${name}؟`, amt);
    if (!finalPay) return;
    const poolId = localStorage.getItem('pool_id');
    await supabaseClient.from('transactions').insert([{ pool_id: poolId, member_id: null, amount: Number(finalPay), status: 'approved', type: 'out', receipt_url: `پرداخت وام: ${name}` }]);
    await supabaseClient.from('loans').update({ status: 'paid' }).eq('id', id);
    const { data: m } = await supabaseClient.from('members').select('debt_target').eq('full_name', name).maybeSingle();
    await supabaseClient.from('members').update({ debt_target: (Number(m?.debt_target) || 0) + Number(finalPay) }).eq('full_name', name);
    alert("وام پرداخت شد"); location.reload();
}



// ۱. تابع ثبت پروژه و کسر آنی از صندوق سرمایه‌گذاری
async function createNewProject() {
    const name = document.getElementById('proj-name').value.trim();
    const capital = document.getElementById('proj-capital').value;
    const poolId = localStorage.getItem('pool_id');

    if (!name || !capital) return alert("لطفاً نام و مبلغ سرمایه را وارد کنید ❌");
    const capitalAmt = Number(capital);

    try {
        // الف) ثبت تراکنش خروجی از نوع capital_spend (فقط از صندوق سرمایه کم می‌کند)
        const { error: txErr } = await supabaseClient.from('transactions').insert([{
            pool_id: poolId,
            amount: capitalAmt,
            status: 'approved',
            type: 'capital_spend', // نوع مخصوص برای کسر از صندوق سرمایه
            receipt_url: `خرید اولیه پروژه: ${name}`
        }]);

        if (txErr) throw txErr;

        // ب) ایجاد ردیف پروژه در جدول پروژه‌ها
        const { error: prErr } = await supabaseClient.from('projects').insert([{
            pool_id: poolId,
            name: name,
            target_amount: capitalAmt,
            invested_amount: capitalAmt, // پولی که الان گذاشتیم
            status: 'active'
        }]);

        if (prErr) throw prErr;

        alert(`✅ دارایی پروژه "${name}" خریداری شد و مبلغ از صندوق سرمایه کسر گردید.`);
        document.getElementById('proj-name').value = "";
        document.getElementById('proj-capital').value = "";

        calculateStats(poolId); // بروزرسانی موجودی ۳ صندوق
        loadAdminProjects(poolId); // بروزرسانی لیست

    } catch (e) {
        alert("خطا در فرآیند خرید پروژه: " + e.message);
    }
}

// ۲. لود لیست پروژه‌ها با نمایش سود و زیان (ROI)
/************************************************
 * نمایش لیست پروژه‌ها با محاسبات سود و زیان (ROI)
 ************************************************/
/************************************************
 * نمایش لیست پروژه‌ها با دکمه حذف بزرگ و قرمز
 ************************************************/
async function loadAdminProjects(poolId) {
    try {
        // ۱. دریافت لیست پروژه‌ها از دیتابیس
        const { data: projs, error } = await supabaseClient
            .from('projects')
            .select('*')
            .eq('pool_id', poolId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const container = document.getElementById('admin-projects-list');
        if (!container) return;

        // ۲. اگر پروژه‌ای وجود نداشت
        if (!projs || projs.length === 0) {
            container.innerHTML = `
                <div class="text-center py-10 bg-white rounded-[2.5rem] border border-dashed border-slate-200">
                    <i class="fas fa-box-open text-slate-200 text-4xl mb-3"></i>
                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">No Active Projects</p>
                </div>`;
            return;
        }

        // ۳. رندر کردن کارت‌های پروژه
        container.innerHTML = projs.map(p => {
            // محاسبه نرخ بازگشت سرمایه (ROI)
            const profit = Number(p.total_profit || 0);
            const investment = Number(p.invested_amount || 1); 
            const roi = ((profit / investment) * 100).toFixed(1);

            return `
                <div class="bg-white p-6 rounded-[2.5rem] border border-slate-100 mb-5 shadow-sm text-right relative overflow-hidden transition-all active:shadow-md">
                    <!-- هدر کارت: نام و حذف -->
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h4 class="text-xs font-black text-slate-800">${p.name}</h4>
                            <p class="text-[8px] text-slate-400 font-bold uppercase mt-1">سرمایه خرید: ${investment.toLocaleString()} ت</p>
                        </div>
                        <div class="text-left flex flex-col items-end gap-2">
                            <span class="px-2 py-0.5 rounded-lg text-[9px] font-black ${profit >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}">
                                ${profit >= 0 ? '+' : ''}${roi}% بازدهی
                            </span>
                            
                            <!-- 👇 اصلاح دکمه حذف: بزرگ، قرمز و با دسترسی راحت در گوشی -->
                            <button onclick="deleteProject(${p.id}, '${p.name}')" 
                                    class="w-10 h-10 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center active:scale-90 transition-all border border-rose-100 shadow-sm">
                                <i class="fas fa-trash-alt text-base"></i>
                            </button>
                        </div>
                    </div>
                    
                    <!-- کادر سود انباشته فعلی -->
                    <div class="bg-slate-50 p-4 rounded-2xl flex justify-between items-center mb-5 shadow-inner border border-slate-100">
                        <div class="flex items-center gap-2">
                            <div class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                            <span class="text-[9px] text-slate-500 font-bold">سود موجود در این پروژه:</span>
                        </div>
                        <span class="text-xs font-black text-slate-800">${profit.toLocaleString()} <span class="text-[9px] font-normal opacity-50 text-slate-400">تومان</span></span>
                    </div>

                    <!-- دکمه‌های عملیاتی پروژه -->
                    <div class="grid grid-cols-2 gap-2">
                        <!-- دکمه ورود سود جدید -->
                        <button onclick="registerProjectProfit(${p.id}, '${p.name}')" 
                                class="btn-tap bg-emerald-600 text-white py-3.5 rounded-2xl font-black text-[9px] shadow-lg shadow-emerald-100 flex items-center justify-center gap-1">
                            <i class="fas fa-plus-circle text-[10px]"></i>
                            ثبت سود جدید
                        </button>

                        <!-- دکمه مدیریت سود (توزیع یا انباشت) -->
                        <button onclick="openProfitManager(${p.id}, '${p.name}', ${p.total_profit})" 
                                class="btn-tap bg-indigo-600 text-white py-3.5 rounded-2xl font-black text-[9px] shadow-lg shadow-indigo-100 flex items-center justify-center gap-1">
                            <i class="fas fa-tasks text-[10px]"></i>
                            مدیریت سود
                        </button>
                    </div>

                    <!-- افکت تزئینی پشت کارت -->
                    <i class="fas fa-chart-pie absolute -bottom-6 -left-6 text-7xl opacity-[0.03] -rotate-12"></i>
                </div>`;
        }).join('');

    } catch (err) {
        console.error("❌ خطا در نمایش پروژه‌ها:", err.message);
        const container = document.getElementById('admin-projects-list');
        if (container) container.innerHTML = `<p class="text-center text-rose-500 text-[10px] font-bold py-10">خطا در بارگذاری لیست پروژه‌ها</p>`;
    }
}

// ۳. ثبت سود پروژه (مستقیم به صندوق سود می‌رود و آنجا انباشته می‌شود)
async function registerProjectProfit(id, name) {
    let profit = prompt(`سود خالص جدید دریافتی از "${name}" چقدر است؟\n(این مبلغ به "صندوق سود" اضافه می‌شود)`);
    if (!profit) return;
    const poolId = localStorage.getItem('pool_id');

    try {
        // ثبت در تراکنش‌ها به عنوان نوع profit (فقط تراز صندوق سود را بالا می‌برد)
        await supabaseClient.from('transactions').insert([{
            pool_id: poolId,
            amount: Number(profit),
            status: 'approved',
            type: 'profit',
            receipt_url: `سود حاصله پروژه: ${name}`
        }]);

        // بروزرسانی سود انباشته در جدول پروژه‌ها
        const { data: proj } = await supabaseClient.from('projects').select('total_profit').eq('id', id).single();
        await supabaseClient.from('projects').update({ 
            total_profit: Number(proj.total_profit || 0) + Number(profit) 
        }).eq('id', id);

        alert("سود پروژه با موفقیت در صندوق سود ذخیره شد 💰");
        calculateStats(poolId);
        loadAdminProjects(poolId);
    } catch (e) { alert("خطا در ثبت سود"); }
}


async function distributeProfit(id, name) {
    const poolId = localStorage.getItem('pool_id');
    let prof = prompt(`مبلغ کل سود حاصله از پروژه "${name}" برای توزیع؟`);
    if (!prof) return;
    const { data: members } = await supabaseClient.from('members').select('id, total_shares').eq('pool_id', poolId);
    const totalShares = members.reduce((s, m) => s + (m.total_shares || 1), 0);
    const profitPerShare = Number(prof) / totalShares;
    for (const m of members) {
        await supabaseClient.from('transactions').insert([{ pool_id: poolId, member_id: m.id, amount: Math.floor(profitPerShare * m.total_shares), status: 'approved', type: 'in', receipt_url: `سود پروژه: ${name}` }]);
    }
    alert("سود توزیع شد 🎊"); location.reload();
}

/************************************************
 * ۷. مدیریت فیش‌ها، سهمیه و تنظیمات
 ************************************************/
async function loadPendingReceipts(poolId) {
    const { data } = await supabaseClient.from('transactions').select('*').eq('pool_id', poolId).eq('status', 'pending');
    const container = document.getElementById('pending-list');
    if (data && container) {
        container.innerHTML = data.map(t => `
            <div class="bg-white p-4 rounded-3xl border flex items-center justify-between mb-3 shadow-sm">
                <div class="flex gap-1.5"><button onclick="updateStatus(${t.id},'rejected')" class="w-9 h-9 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center"><i class="fas fa-times"></i></button><button onclick="updateStatus(${t.id},'approved')" class="w-9 h-9 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center"><i class="fas fa-check"></i></button></div>
                <div class="text-right flex-1 px-3"><p class="text-[10px] font-black">عضو ${t.member_id || 'سیستمی'}</p><p class="text-[9px] text-slate-400">${Number(t.amount).toLocaleString()} ت</p></div>
                <a href="${t.receipt_url}" target="_blank" class="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 border border-indigo-100 shadow-sm"><i class="fas fa-eye text-lg"></i></a>
            </div>`).join('');
        document.getElementById('pending-count').innerText = data.length;
    }
}

async function addNewMember() {
    const n = document.getElementById('new-member-name').value, m = document.getElementById('new-member-mobile').value, p = document.getElementById('new-member-pass').value, s = document.getElementById('new-member-shares').value || 1, adm = document.getElementById('new-member-is-admin').checked, poolId = localStorage.getItem('pool_id');
    const { data: pool } = await supabaseClient.from('pools').select('member_capacity').eq('id', poolId).single();
    if (pool.member_capacity < Number(s)) return alert("ظرفیت کافی نیست ❌");
    if(!n || !m) return alert("نام و شماره الزامی است");
    const { error } = await supabaseClient.from('members').insert([{ pool_id: poolId, full_name: n, mobile: m, password: p, total_shares: parseInt(s), won_shares: 0, has_won: false, is_admin: adm, credit_score: 100 }]);
    if(!error) {
        await supabaseClient.from('pools').update({ member_capacity: pool.member_capacity - Number(s) }).eq('id', poolId);
        alert("ثبت شد ✅"); location.reload();
    }
}

async function saveNewAmounts() {
    const poolId = localStorage.getItem('pool_id');
    const b = document.getElementById('set-base-amount').value, w = document.getElementById('set-won-amount').value, n = document.getElementById('set-invest-percent').value;
    await supabaseClient.from('settings').update({ base_amount: Number(b), won_amount: Number(w), investment_percent: Number(n) }).eq('pool_id', poolId);
    alert("ذخیره شد ✅");
}

async function loadCurrentConfig(poolId) {
    const { data } = await supabaseClient.from('settings').select('*').eq('pool_id', poolId).maybeSingle();
    if (data) { 
        document.getElementById('set-base-amount').value = data.base_amount; 
        document.getElementById('set-won-amount').value = data.won_amount; 
        document.getElementById('set-invest-percent').value = data.investment_percent || 0;
    }
}

/************************************************
 * ۸. ابزارهای امنیتی و سیستمی
 ************************************************/
function openEditModalById(id) {
    const m = allMembersData.find(x => x.id === id);
    if (!m) return;
    document.getElementById('edit-member-id').value = m.id;
    document.getElementById('edit-member-name').value = m.full_name;
    document.getElementById('edit-member-mobile').value = m.mobile;
    document.getElementById('edit-member-shares').value = m.total_shares;
    document.getElementById('edit-member-is-admin').checked = m.is_admin;
    document.getElementById('edit-member-pass').value = "";
    document.getElementById('edit-modal').classList.remove('hidden');
}

async function resetLotterySeason() {
    const poolId = localStorage.getItem('pool_id');
    if(!confirm("⚠️ کل دوره ریست شود؟ تمام برنده‌ها و بدهی‌ها صفر می‌شوند.")) return;
    await supabaseClient.from('members').update({ won_shares: 0, has_won: false, debt_target: 0 }).eq('pool_id', poolId);
    await supabaseClient.from('lottery_results').delete().eq('pool_id', poolId);
    alert("صندوق ریست شد 🔄"); location.reload();
}

async function injectSuperAdminButton(userId) {
    const hasKey = localStorage.getItem('master_access_key') === 'Idris_Master_Admin_X';
    if (hasKey && supabaseClient) {
        const { data } = await supabaseClient.from('members').select('is_super_admin').eq('id', userId).maybeSingle();
        if (data && data.is_super_admin) {
            const btn = document.getElementById('super-btn');
            if (btn) btn.classList.remove('hidden');
        }
    }
}

function initSecretClick() {
    let c = 0; const icon = document.querySelector('header i.fa-user-shield');
    if (icon) icon.parentElement.onclick = () => { c++; if (c === 10) { const k = localStorage.getItem('master_access_key'); if(k) localStorage.removeItem('master_access_key'); else localStorage.setItem('master_access_key', 'Idris_Master_Admin_X'); location.reload(); } };
}

/************************************************
 * ارسال نوتیفیکیشن فقط برای اعضایی که قسط نداده‌اند
 ************************************************/
async function sendPushToUnpaid() {
    const APP_ID = "6235857d-565c-4223-bffa-af420f2cd45b"; 
    const API_KEY = "os_v2_app_mi2yk7kwlrbchp72v5ba6lgulm3yudga3sbeet5dt2feqhyer27faufsiea2acnuio5vcmebonhdyyw5vqqo6zfqc3i3gnyw6";
    const poolId = localStorage.getItem('pool_id');

    if (!confirm("🔔 آیا مطمئن هستید که می‌خواهید برای بدهکاران این ماه یادآوری بفرستید؟")) return;

    try {
        // ۱. پیدا کردن تاریخ شروع ماه جاری میلادی
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        // ۲. گرفتن لیست تمام اعضای این صندوق
        const { data: members } = await supabaseClient.from('members').select('id').eq('pool_id', poolId);

        // ۳. گرفتن لیست کسانی که در این ماه پرداخت تایید شده دارند
        const { data: paidUsers } = await supabaseClient
            .from('transactions')
            .select('member_id')
            .eq('pool_id', poolId)
            .eq('status', 'approved')
            .eq('type', 'in')
            .gte('created_at', firstDay);

        const paidIds = paidUsers.map(p => String(p.member_id));
        
        // ۴. فیلتر کردن آیدی بدهکاران
        const unpaidIds = members
            .filter(m => !paidIds.includes(String(m.id)))
            .map(m => String(m.id));

        if (unpaidIds.length === 0) {
            alert("همه اعضا واریزی این ماه را انجام داده‌اند! ✨");
            return;
        }

        // ۵. ارسال پیام به OneSignal
        const response = await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": "Basic " + API_KEY
            },
            body: JSON.stringify({
                app_id: APP_ID,
                include_external_user_ids: unpaidIds, 
                headings: { "fa": "یادآوری واریز قسط" },
                contents: { "fa": "هم‌صندوقی عزیز، قسط این ماه شما هنوز ثبت نشده است. لطفاً نسبت به ارسال فیش اقدام کنید." }
            })
        });

        if (response.ok) {
            alert(`🚀 پیام یادآوری با موفقیت برای ${unpaidIds.length} نفر ارسال شد.`);
        } else {
            alert("❌ خطا در ارسال پیام به سرور.");
        }

    } catch (e) {
        alert("🚨 خطای شبکه: فیلترشکن را چک کنید.");
    }
}


// توابع مودال‌ها و UI
function closeEditModal() { document.getElementById('edit-modal').classList.add('hidden'); }
function closeReportModal() { document.getElementById('report-modal').classList.add('hidden'); }
function openRenewalModal() { document.getElementById('renewal-modal').classList.remove('hidden'); }
function closeRenewalModal() { document.getElementById('renewal-modal').classList.add('hidden'); }
function closeQuotaModal() { document.getElementById('quota-modal').classList.add('hidden'); }
function openBuyQuotaModal() { 
    supabaseClient.from('pools').select('share_price').eq('id', localStorage.getItem('pool_id')).single().then(({data}) => {
        if(data) document.getElementById('display-share-price').innerText = Number(data.share_price).toLocaleString() + " ت";
    });
    document.getElementById('quota-modal').classList.remove('hidden'); 
}
function showLockPage() { document.body.innerHTML = `<div style="height:100vh; background:#0f172a; color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px; font-family:Vazirmatn; direction:rtl;"><i class="fas fa-lock" style="font-size:50px; color:#ef4444; margin-bottom:20px;"></i><h2 style="font-weight:900;">دسترسی مسدود شد</h2><p>اشتراک یا سهمیه این صندوق به پایان رسیده است.</p><button onclick="localStorage.clear(); location.href='login.html'" style="margin-top:30px; background:white; color:black; padding:10px 20px; border-radius:15px; font-weight:bold;">خروج</button></div>`; }
function updateReceiptBadge(poolId) { supabaseClient.from('transactions').select('id').eq('pool_id', poolId).eq('status', 'pending').then(({data}) => { const dot = document.getElementById('receipt-dot'); if (dot && data && data.length > 0) dot.classList.remove('hidden'); }); }

// توابع خرید سهمیه و تمدید اشتراک
async function submitQuotaRequest() {
    const amt = document.getElementById('quota-amount').value, file = document.getElementById('quota-file').files[0], poolId = localStorage.getItem('pool_id');
    if(!amt || !file) return alert("مبلغ و فیش را وارد کنید");
    const fileName = `quota-${poolId}-${Date.now()}.jpg`;
    await supabaseClient.storage.from('receipts').upload(fileName, file);
    const { data: urlData } = supabaseClient.storage.from('receipts').getPublicUrl(fileName);
    await supabaseClient.from('sub_requests').insert([{ pool_id: poolId, amount: Number(amt), receipt_url: urlData.publicUrl, status: 'pending' }]);
    alert("ارسال شد ✅"); closeQuotaModal();
}

async function submitRenewalRequest() {
    const amt = document.getElementById('renewal-amount').value, file = document.getElementById('renewal-file').files[0], poolId = localStorage.getItem('pool_id');
    if(!amt || !file) return alert("مبلغ و فیش را وارد کنید");
    const fileName = `renewal-${poolId}-${Date.now()}.jpg`;
    await supabaseClient.storage.from('receipts').upload(fileName, file);
    const { data: urlData } = supabaseClient.storage.from('receipts').getPublicUrl(fileName);
    await supabaseClient.from('sub_requests').insert([{ pool_id: poolId, amount: Number(amt), receipt_url: urlData.publicUrl, status: 'pending' }]);
    alert("ارسال شد ✅"); closeRenewalModal();
}

// تابع تایید یا رد فیش (اصلاح شده و قطعی)
/************************************************
 * تابع تایید/رد فیش + محاسبه امتیاز (حداکثر ۱۰۰٪)
 ************************************************/
/************************************************
 * تابع تایید/رد فیش + محاسبه امتیاز (حداکثر ۱۰۰٪)
 ************************************************/
/************************************************
 * تابع تایید/رد فیش (نسخه جامع)
 * شامل: تایید مالی، محاسبه سهم سرمایه‌گذاری و امتیاز خوش‌حسابی
 ************************************************/
 window.updateStatus = async function(id, newStatus) {
    const myPoolId = localStorage.getItem('pool_id');
    try {
        if (newStatus === 'approved') {
            // الف) گرفتن اطلاعات فیش و تنظیمات درصد فعلی
            const { data: tx } = await supabaseClient.from('transactions').select('*').eq('id', id).single();
            const { data: set } = await supabaseClient.from('settings').select('investment_percent').eq('pool_id', myPoolId).maybeSingle();

            const currentN = set ? Number(set.investment_percent || 0) : 0;
            const investAmount = Math.floor((Number(tx.amount) * currentN) / 100);

            // ب) تایید و ثبت سهم سرمایه در تراکنش
            const { error: updErr } = await supabaseClient
                .from('transactions')
                .update({ 
                    status: 'approved', 
                    invest_val: investAmount 
                })
                .eq('id', id);

            if (updErr) throw updErr;

            // ج) آپدیت امتیاز عضو
            if (tx.member_id) {
                const day = new Date(tx.created_at).getDate();
                const { data: mem } = await supabaseClient.from('members').select('credit_score').eq('id', tx.member_id).single();
                let newScore = Number(mem.credit_score || 100) + (day <= 10 ? 2 : -10);
                newScore = Math.max(0, Math.min(100, newScore));
                await supabaseClient.from('members').update({ credit_score: newScore }).eq('id', tx.member_id);
            }
        } else {
            // رد فیش
            await supabaseClient.from('transactions').update({ status: 'rejected', invest_val: 0 }).eq('id', id);
        }

        alert("عملیات با موفقیت انجام شد ✅");

        // بروزرسانی آنی صفحه
        loadPendingReceipts(myPoolId);
        calculateStats(myPoolId);
        loadAllMembers(myPoolId);

    } catch (e) {
        alert("خطا: " + e.message);
        console.error(e);
    }
};

async function exportTransactionsToExcel() {
    const myPoolId = localStorage.getItem('pool_id');
    const btn = event.currentTarget;

    btn.disabled = true;
    btn.innerHTML = 'در حال تولید فایل واقعی...';

    try {
        // ۱. دریافت داده‌های واریزی از جدول transactions
        // دقت کن که فقط جدول تراکنش‌ها رو هدف می‌گیریم
        const { data: txs, error } = await supabaseClient
            .from('transactions')
            .select('amount, type, created_at, members(full_name)')
            .eq('pool_id', myPoolId)
            .eq('status', 'approved')
            .eq('type', 'in'); // فقط ورودی‌ها (قسط‌ها)

        if (error) throw error;

        if (!txs || txs.length === 0) {
            alert("هیچ تراکنش تایید شده‌ای برای گزارش‌گیری یافت نشد.");
            btn.disabled = false;
            btn.innerHTML = 'دریافت گزارش اکسل';
            return;
        }

        // ۲. مرتب سازی داده‌ها برای نمایش در اکسل
        const excelData = txs.map(t => ({
            "نام و نام خانوادگی": t.members ? t.members.full_name : "نامشخص",
            "مبلغ واریزی (تومان)": Number(t.amount),
            "تاریخ واریز": new Date(t.created_at).toLocaleDateString('fa-IR'),
            "وضعیت": "تایید شده"
        }));

        // ۳. تبدیل به فایل اکسل
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "لیست واریزی‌ها");

        // ۴. دانلود با نام مشخص
        XLSX.writeFile(workbook, `Vaziri_Report_${myPoolId}.xlsx`);

        alert("گزارش واقعی واریزی‌ها دانلود شد ✅");

    } catch (e) {
        alert("خطا در سیستم گزارش‌گیری: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'دریافت گزارش اکسل (واریزی‌ها)';
    }
}

/************************************************
 * مرکز مدیریت و اجرای تصمیمات سود پروژه
 ************************************************/

// ۱. تابع اصلی اجرای عملیات (توزیع، انباشت یا ترکیبی)
async function executeProfitAction(actionType) {
    const poolId = localStorage.getItem('pool_id');
    const projId = document.getElementById('pm-proj-id').value;
    const availableProfit = Number(document.getElementById('pm-available-profit').value);

    if (availableProfit <= 0) return alert("سودی برای مدیریت وجود ندارد! ❌");

    // درخواست مبلغی که مدیر قصد دارد برای آن تصمیم بگیرد
    let amountToProcess = prompt(`مبلغی که می‌خواهید مدیریت کنید را وارد کنید (حداکثر ${availableProfit.toLocaleString()} ت):`, availableProfit);

    if (!amountToProcess || Number(amountToProcess) > availableProfit || Number(amountToProcess) <= 0) {
        return alert("مبلغ وارد شده نامعتبر است ⚠️");
    }

    const finalAmt = Number(amountToProcess);
    const btn = event.currentTarget;
    btn.disabled = true; btn.innerText = "در حال پردازش مالی...";

    try {
        if (actionType === 'distribute') {
            // --- حالت ۱: ۱۰۰٪ توزیع بین اعضا ---
            await distributeProfitToMembers(poolId, finalAmt, `توزیع سود پروژه ID:${projId}`);
            // ثبت خروج از صندوق سود
            await supabaseClient.from('transactions').insert([{ 
                pool_id: poolId, amount: finalAmt, status: 'approved', type: 'distribution', receipt_url: 'خروج سود جهت توزیع' 
            }]);

        } else if (actionType === 'reinvest') {
            // --- حالت ۲: ۱۰۰٪ بازگشت به سرمایه ---
            // ۱. کسر از تراز سود
            await supabaseClient.from('transactions').insert([{ 
                pool_id: poolId, amount: finalAmt, status: 'approved', type: 'distribution', receipt_url: 'انتقال سود به سرمایه' 
            }]);
            // ۲. اضافه کردن به تراز سرمایه (از طریق invest_val)
            await supabaseClient.from('transactions').insert([{ 
                pool_id: poolId, amount: 0, invest_val: finalAmt, status: 'approved', type: 'in', receipt_url: 'افزایش سرمایه از سود' 
            }]);

        } else if (actionType === 'split') {
            // --- حالت ۳: ۵۰٪ سرمایه / ۵۰٪ اعضا ---
            const half = Math.floor(finalAmt / 2);
            // توزیع نیمی از سود بین اعضا
            await distributeProfitToMembers(poolId, half, `۵۰٪ سود پروژه ID:${projId}`);
            // ثبت کسر کل مبلغ از تراز سود
            await supabaseClient.from('transactions').insert([{ 
                pool_id: poolId, amount: finalAmt, status: 'approved', type: 'distribution', receipt_url: 'توزیع و بازگشت سود (۵۰/۵۰)' 
            }]);
            // اضافه کردن نیمی دیگر به تراز سرمایه
            await supabaseClient.from('transactions').insert([{ 
                pool_id: poolId, amount: 0, invest_val: half, status: 'approved', type: 'in', receipt_url: '۵۰٪ سود سهم سرمایه' 
            }]);
        }

        // بروزرسانی سود باقی‌مانده در پرونده پروژه
        const { data: proj } = await supabaseClient.from('projects').select('total_profit').eq('id', projId).single();
        await supabaseClient.from('projects').update({ 
            total_profit: Math.max(0, Number(proj.total_profit) - finalAmt) 
        }).eq('id', projId);

        alert("عملیات مالی با موفقیت در دیتابیس ثبت شد ✅");
        document.getElementById('profit-manager-modal').classList.add('hidden');

        // آپدیت آنی آمار و لیست پروژه‌ها
        calculateStats(poolId);
        loadAdminProjects(poolId);

    } catch (e) {
        alert("خطا در پردازش عملیات: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "اجرای عملیات";
    }
}

// ۲. تابع کمکی برای تقسیم پول بین تمام اعضا به نسبت سهم
async function distributeProfitToMembers(poolId, amount, label) {
    // گرفتن لیست تمام اعضا و مجموع سهم‌های صندوق
    const { data: members } = await supabaseClient.from('members').select('id, total_shares').eq('pool_id', poolId);
    const totalAllShares = members.reduce((s, m) => s + (m.total_shares || 1), 0);
    const profitPerShare = amount / totalAllShares;

    // واریز سود به قلک تک‌تک اعضا در دیتابیس
    for (const m of members) {
        const memberProfit = Math.floor(profitPerShare * (m.total_shares || 1));
        if (memberProfit > 0) {
            await supabaseClient.from('transactions').insert([{ 
                pool_id: poolId, 
                member_id: m.id, 
                amount: memberProfit, 
                status: 'approved', 
                type: 'in', 
                receipt_url: label 
            }]);
        }
    }
}


/************************************************
 * تابع باز کردن پنجره مدیریت و توزیع سود
 ************************************************/
function openProfitManager(id, name, profit) {
    // ۱. مقداردهی به فیلدهای مخفی برای استفاده در توابع بعدی
    const idInput = document.getElementById('pm-proj-id');
    const profitInput = document.getElementById('pm-available-profit');
    const infoText = document.getElementById('pm-info-text');
    const modal = document.getElementById('profit-manager-modal');

    if (idInput) idInput.value = id;
    if (profitInput) profitInput.value = profit;

    // ۲. نمایش اطلاعات پروژه در متن پنجره
    if (infoText) {
        infoText.innerText = `پروژه: ${name} | سود انباشته فعلی: ${Number(profit).toLocaleString()} تومان`;
    }

    // ۳. ظاهر کردن پنجره (حذف کلاس hidden)
    if (modal) {
        modal.classList.remove('hidden');
        console.log(`مدیریت سود برای پروژه ${name} باز شد.`);
    } else {
        alert("خطا: پنجره مدیریت سود در فایل HTML پیدا نشد!");
    }
}

/************************************************
 * تابع حذف کامل یک پروژه از سیستم
 ************************************************/
async function deleteProject(id, name) {
    // ۱. تاییدیه از مدیر برای جلوگیری از حذف تصادفی
    if (!confirm(`⚠️ هشدار!\nآیا از حذف پروژه "${name}" مطمئن هستید؟\nبا این کار تمام سوابق سود و زیان این پروژه از لیست پاک خواهد شد.`)) {
        return;
    }

    try {
        const myPoolId = localStorage.getItem('pool_id');

        // ۲. دستور حذف از جدول پروژه‌ها در Supabase
        const { error } = await supabaseClient
            .from('projects')
            .delete()
            .eq('id', id);

        if (error) throw error;

        // ۳. اطلاع‌رسانی و بروزرسانی لیست پروژه‌ها
        alert(`پروژه "${name}" با موفقیت حذف شد 🗑️`);

        // اجرای توابع لودینگ برای آپدیت آنی صفحه
        if (typeof loadAdminProjects === 'function') {
            loadAdminProjects(myPoolId);
        }

        // آپدیت آمار کلی صندوق‌ها
        if (typeof calculateStats === 'function') {
            calculateStats(myPoolId);
        }

    } catch (e) {
        console.error("Error deleting project:", e.message);
        alert("خطا در حذف پروژه: " + e.message);
    }
}

/************************************************
 * تابع شناسایی هویت مدیر در وان‌سیگنال
 ************************************************/
function initOneSignalAdmin(myPoolId) {
    if (typeof OneSignal !== 'undefined') {
        OneSignal.push(function() {
            // تگ زدن به مدیر برای دریافت اعلان‌های واریز فیش و وام
            OneSignal.User.addTag("role", "admin");
            OneSignal.User.addTag("pool_id", String(myPoolId));
            console.log("✅ هویت مدیریتی شما به وان‌سیگنال اعلام شد.");
        });
    } else {
        console.log("⚠️ کتابخانه وان‌سیگنال هنوز بارگذاری نشده است.");
    }
}
/************************************************
 * ارسال پیام همگانی به تمام اعضای صندوق
 ************************************************/
async function sendPushToAll() {
    const APP_ID = "6235857d-565c-4223-bffa-af420f2cd45b"; 
    const API_KEY = "os_v2_app_mi2yk7kwlrbchp72v5ba6lgulm3yudga3sbeet5dt2feqhyer27faufsiea2acnuio5vcmebonhdyyw5vqqo6zfqc3i3gnyw6";
    const poolId = localStorage.getItem('pool_id');

    let msg = prompt("متن پیام اطلاع‌رسانی عمومی را وارد کنید:");
    if (!msg) return;

    try {
        const response = await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": "Basic " + API_KEY
            },
            body: JSON.stringify({
                app_id: APP_ID,
                // فیلتر برای ارسال فقط به اعضای همین صندوق خاص
                filters: [
                    { "field": "tag", "key": "pool_id", "relation": "=", "value": String(poolId) }
                ],
                headings: { "fa": "اطلاعیه جدید صندوق" },
                contents: { "fa": msg }
            })
        });

        if (response.ok) alert("🚀 پیام برای همه اعضا ارسال شد.");
        else alert("❌ خطا در ارسال.");
    } catch (e) {
        alert("🚨 خطا در اتصال به اینترنت.");
    }
}

/************************************************
 * تابع ذخیره تغییرات ویرایش عضو (نهایی و بدون خطا)
 ************************************************/
/************************************************
 * تابع ویرایش عضو با قابلیت کسر/اضافه سهمیه هوشمند
 ************************************************/
async function updateMember() {
    const id = document.getElementById('edit-member-id').value;
    const newName = document.getElementById('edit-member-name').value;
    const newMobile = document.getElementById('edit-member-mobile').value;
    const newPass = document.getElementById('edit-member-pass').value;
    const newShares = parseInt(document.getElementById('edit-member-shares').value) || 1;
    const isAdmin = document.getElementById('edit-member-is-admin').checked;
    const poolId = localStorage.getItem('pool_id');

    const btn = event.currentTarget;
    btn.disabled = true; btn.innerText = "در حال بروزرسانی...";

    try {
        // ۱. گرفتن اطلاعات فعلی عضو و وضعیت سهمیه صندوق
        const { data: oldMember } = await supabaseClient.from('members').select('total_shares').eq('id', id).single();
        const { data: pool } = await supabaseClient.from('pools').select('member_capacity').eq('id', poolId).single();

        const shareDifference = newShares - oldMember.total_shares; // محاسبه اختلاف

        // ۲. اگر سهم زیاد شده، چک کن سهمیه کافی هست یا نه
        if (shareDifference > 0) {
            if (pool.member_capacity < shareDifference) {
                alert(`❌ سهمیه شما کافی نیست! برای اضافه کردن ${shareDifference} سهم جدید، نیاز به خرید سهمیه دارید.`);
                btn.disabled = false; btn.innerText = "ذخیره نهایی";
                return;
            }
            // کسر مابه‌التفاوت از سهمیه کل
            await supabaseClient.from('pools').update({ member_capacity: pool.member_capacity - shareDifference }).eq('id', poolId);
        } 
        // ۳. اگر سهم کم شده، مابه‌التفاوت به سهمیه کل برگردد
        else if (shareDifference < 0) {
            await supabaseClient.from('pools').update({ member_capacity: pool.member_capacity + Math.abs(shareDifference) }).eq('id', poolId);
        }

        // ۴. آپدیت نهایی اطلاعات عضو
        let updateData = {
            full_name: newName,
            mobile: newMobile,
            total_shares: newShares,
            is_admin: isAdmin
        };
        if (newPass) updateData.password = newPass;

        const { error: finalErr } = await supabaseClient.from('members').update(updateData).eq('id', id);

        if (finalErr) throw finalErr;

        alert("تغییرات با موفقیت اعمال و سهمیه بروزرسانی شد ✅");
        location.reload();

    } catch (e) {
        alert("خطا در ویرایش: " + e.message);
        btn.disabled = false; btn.innerText = "ذخیره نهایی";
    }
}