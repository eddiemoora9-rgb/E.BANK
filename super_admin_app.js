/************************************************
 * ۱. تنظیمات اتصال و متغیرهای سراسری
 ************************************************/
var SUPABASE_URL = 'https://kqnsbnpznkwkwukzokik.supabase.co';
var SUPABASE_KEY = 'sb_publishable_ZqXeccdaSzZUivCwU38WcQ_m05uT4y6';
var supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// متغیر برای ذخیره لیست صندوق‌ها جهت دسترسی سریع توابع
var allPoolsCache = [];

/************************************************
 * ۲. موتور اصلی ورود و تایید هویت
 ************************************************/


document.addEventListener('DOMContentLoaded', async () => {
    const userId = localStorage.getItem('user_id');
    const MY_SECRET_PASSWORD = "@EddiE-Moradi1993"; // رمز عبور شما

    if (!userId) {
        window.location.replace('login.html');
        return;
    }

    // الف) درخواست رمز عبور لحظه‌ای
    let entryKey = prompt("لطفاً رمز عبور ستاد فرماندهی را وارد کنید:");

    if (entryKey === MY_SECRET_PASSWORD) {
        // ب) استعلام امنیتی از دیتابیس
        const { data: user, error } = await supabaseClient
            .from('members')
            .select('is_super_admin')
            .eq('id', userId)
            .maybeSingle();

        if (user && user.is_super_admin === true) {
            console.log("👑 هویت ابر-مدیر تایید شد.");
            loadMasterStats(); // اجرای تابع اصلی بارگذاری
        } else {
            alert("خطا: حساب شما دسترسی سوپر ادمین ندارد.");
            window.location.replace('login.html');
        }
    } else {
        alert("رمز عبور اشتباه است ⛔");
        window.location.replace('admin.html');
    }
});

/************************************************
 * ۳. بارگذاری آمار کل و لیست صندوق‌ها
 ************************************************/
async function loadMasterStats() {
    try {
        // ۱. دریافت تمام صندوق‌ها
        const { data: pools, error: pErr } = await supabaseClient
            .from('pools')
            .select('*')
            .order('created_at', { ascending: false });

        if (pErr) throw pErr;
        allPoolsCache = pools || [];

        // ۲. دریافت تعداد کل اعضای سیستم
        const { count: userCount } = await supabaseClient
            .from('members')
            .select('*', { count: 'exact', head: true });

        // ۳. نمایش آمار در کارت‌های بالا
        document.getElementById('total-pools').innerText = allPoolsCache.length;
        document.getElementById('total-users').innerText = userCount || 0;

        // ۴. رندر کردن لیست صندوق‌ها با تنظیمات اختصاصی
        renderPoolsList();

    } catch (e) {
        console.error("Master Load Error:", e.message);
        alert("خطا در بارگذاری اطلاعات ستاد");
    }
}

function renderPoolsList() {
    const container = document.getElementById('pools-list');
    if (!container) return;
    container.innerHTML = '';

    allPoolsCache.forEach(pool => {
        const isActive = pool.is_active !== false;
        const expiryDate = pool.sub_expiry ? new Date(pool.sub_expiry).toLocaleDateString('fa-IR') : 'نامشخص';

        container.innerHTML += `
            <div class="bg-slate-800 p-6 rounded-[2.5rem] gold-border mb-6 space-y-4 shadow-2xl">
                <!-- هدر کارت صندوق -->
                <div class="flex justify-between items-start">
                    <div class="text-right">
                        <h4 class="text-sm font-black text-white">${pool.pool_name}</h4>
                        <p class="text-[9px] text-slate-400 mt-1">کد ورود: <span class="text-yellow-500 font-bold">${pool.pool_code}</span></p>
                        <p class="text-[9px] text-slate-500">انقضا: ${expiryDate}</p>
                    </div>
                    <button onclick="togglePoolStatus(${pool.id}, ${isActive})" 
                        class="w-10 h-10 ${isActive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'} rounded-2xl flex items-center justify-center shadow-lg active:scale-90 transition-all">
                        <i class="fas ${isActive ? 'fa-unlock' : 'fa-lock'} text-xs"></i>
                    </button>
                </div>

                <!-- بخش مدیریت مالی (تنظیمات قیمت و ظرفیت) -->
                <div class="bg-slate-900/50 p-4 rounded-3xl border border-slate-700/50 space-y-3">
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-[7px] text-slate-500 block mb-1 font-bold">هزینه تمدید (تومان):</label>
                            <input type="number" id="price-${pool.id}" value="${pool.sub_price || 100000}" 
                                class="w-full bg-transparent text-[10px] font-black text-yellow-500 outline-none">
                        </div>
                        <div>
                            <label class="text-[7px] text-slate-500 block mb-1 font-bold">مدت تمدید (روز):</label>
                            <input type="number" id="days-${pool.id}" value="${pool.sub_duration_days || 30}" 
                                class="w-full bg-transparent text-[10px] font-black text-white outline-none">
                        </div>
                    </div>
                    
                    <!-- فیلد جدید: قیمت هر سهمیه 👇 -->
                    <div class="pt-2 border-t border-slate-700/50">
                        <label class="text-[7px] text-slate-500 block mb-1 font-bold uppercase tracking-widest">Price per Share / قیمت هر سهمیه (تومان):</label>
                        <input type="number" id="share-price-${pool.id}" value="${pool.share_price || 10000}" 
                            class="w-full bg-transparent text-[11px] font-black text-emerald-400 outline-none">
                    </div>
                </div>

                <!-- دکمه‌های عملیاتی پایین کارت -->
                <div class="grid grid-cols-2 gap-2">
                    <button onclick="updatePoolBilling(${pool.id})" class="bg-slate-700 text-white py-3 rounded-2xl text-[9px] font-black active:scale-95 transition-all">
                        بروزرسانی تعرفه‌ها
                    </button>
                    <button onclick="viewSubRequests(${pool.id}, '${pool.pool_name}')" class="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 py-3 rounded-2xl text-[9px] font-black active:scale-95 transition-all">
                        بررسی فیش‌ها
                    </button>
                </div>
            </div>
        `;
    });
}
/************************************************
 * ۴. توابع عملیاتی (تغییر وضعیت، تمدید، سهمیه)
 ************************************************/

// تایید فیش و افزایش ظرفیت عضوگیری (Pay-per-Member)
async function approveMemberQuota(requestId, poolId, paidAmount) {
    try {
        // ۱. گرفتن قیمت سهمیه اختصاصی این صندوق
        const { data: pool } = await supabaseClient.from('pools').select('member_capacity, share_price').eq('id', poolId).single();
        
        const pricePerSlot = pool.share_price || 10000;
        const newSlots = Math.floor(Number(paidAmount) / pricePerSlot); // تقسیم بر قیمت اختصاصی

        if (newSlots <= 0) return alert("مبلغ واریزی برای خرید حتی یک سهمیه هم کافی نیست!");

        // ۲. آپدیت ظرفیت
        await supabaseClient.from('pools').update({
            member_capacity: (pool.member_capacity || 0) + newSlots
        }).eq('id', poolId);

        // ۳. تایید فیش
        await supabaseClient.from('sub_requests').update({ status: 'approved' }).eq('id', requestId);
        
        alert(`✅ تایید شد. ${newSlots} سهمیه به ظرفیت صندوق اضافه شد.`);
        loadMasterStats();
    } catch (e) { alert("خطا در تایید سهمیه"); }
}

// تایید فیش و تمدید تاریخ انقضا (Subscription)
async function approveSubscription(requestId, poolId, daysToAdd) {
    try {
        const { data: pool } = await supabaseClient.from('pools').select('sub_expiry').eq('id', poolId).single();
        let currentExpiry = new Date(pool.sub_expiry);
        let startDate = currentExpiry > new Date() ? currentExpiry : new Date();
        
        startDate.setDate(startDate.getDate() + Number(daysToAdd));

        await supabaseClient.from('pools').update({ 
            sub_expiry: startDate.toISOString(),
            is_active: true 
        }).eq('id', poolId);

        await supabaseClient.from('sub_requests').update({ status: 'approved' }).eq('id', requestId);

        alert("✅ اشتراک تمدید و قفل پنل باز شد.");
        loadMasterStats();
    } catch (e) { alert("خطا در تمدید"); }
}

// آپدیت قیمت اختصاصی برای هر صندوق
async function updatePoolBilling(poolId) {
    const price = document.getElementById(`price-${poolId}`).value; // قیمت تمدید زمان
    const sPrice = document.getElementById(`share-price-${poolId}`).value; // قیمت هر سهمیه

    const { error } = await supabaseClient
        .from('pools')
        .update({ 
            sub_price: Number(price), 
            share_price: Number(sPrice) // ذخیره قیمت سهمیه
        })
        .eq('id', poolId);

    if (!error) alert("تعرفه‌های جدید برای این صندوق اعمال شد ✅");
    else alert("خطا در بروزرسانی");
}
// مشاهده فیش‌های ارسال شده (نمایش ساده در آلرت)
// تابع نمایش لیست فیش‌های تمدید و سهمیه به صورت مدرن
async function viewSubRequests(poolId, poolName) {
    try {
        const { data: requests, error } = await supabaseClient
            .from('sub_requests')
            .select('*')
            .eq('pool_id', poolId)
            .eq('status', 'pending');

        if (error) throw error;

        if (!requests || requests.length === 0) {
            return alert(`هیچ فیش منتظری برای "${poolName}" وجود ندارد.`);
        }

        // ایجاد یک پوشش (Overlay) برای نمایش لیست فیش‌ها
        const modal = document.createElement('div');
        modal.style = "fixed; inset:0; background:rgba(0,0,0,0.8); backdrop-filter:blur(10px); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px; direction:rtl; font-family:Vazirmatn, sans-serif;";
        modal.id = "temp-sub-modal";

        let listHtml = `<div class="bg-slate-900 w-full max-w-md rounded-[2.5rem] p-6 border border-slate-700 shadow-2xl">
            <h3 class="text-white font-black text-sm mb-4 text-center">فیش‌های ارسالی: ${poolName}</h3>
            <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-2">`;

        requests.forEach(req => {
            listHtml += `
                <div class="bg-slate-800 p-4 rounded-3xl border border-slate-700">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-yellow-500 font-black text-xs">${Number(req.amount).toLocaleString()} ت</span>
                        <a href="${req.receipt_url}" target="_blank" class="bg-indigo-600 text-white px-3 py-1.5 rounded-xl text-[9px] font-black shadow-lg">
                           <i class="fas fa-eye ml-1"></i> مشاهده عکس فیش
                        </a>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="approveSubscription(${req.id}, ${poolId}, 30)" class="flex-1 bg-emerald-500 text-white py-2 rounded-xl text-[9px] font-bold">تایید تمدید (۳۰ روز)</button>
                        <button onclick="approveMemberQuota(${req.id}, ${poolId}, ${req.amount})" class="flex-1 bg-blue-500 text-white py-2 rounded-xl text-[9px] font-bold">تایید سهمیه</button>
                    </div>
                </div>`;
        });

        listHtml += `</div>
            <button onclick="document.getElementById('temp-sub-modal').remove()" class="w-full mt-6 py-3 text-slate-400 font-bold text-xs">بستن پنجره</button>
        </div>`;

        modal.innerHTML = listHtml;
        document.body.appendChild(modal);

    } catch (e) {
        alert("خطا در بارگذاری فیش‌ها: " + e.message);
    }
}