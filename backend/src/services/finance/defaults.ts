import type { AccountType } from "./types.js";

/** 创建账本时的默认账户树（家庭双职工模板，源自 beancount 优化版） */
export const DEFAULT_ACCOUNTS: Array<{
  name: string;
  type: AccountType;
  icon?: string;
}> = [
  // ── Assets: 银行卡 ──
  { name: "Assets:Bank:Traffic:Hubby:老公交通银行储蓄卡5535", type: "ASSETS", icon: "Bank" },
  { name: "Assets:Bank:ICBC:Wife:妻子工商银行储蓄卡8138", type: "ASSETS", icon: "Bank" },
  { name: "Assets:Bank:CDYH:Wife:妻子成都银行储蓄卡2648", type: "ASSETS", icon: "Bank" },
  { name: "Assets:Bank:SCB:Wife:四川银行储蓄卡0552", type: "ASSETS", icon: "Bank" },
  { name: "Assets:Bank:CMB:Hubby:老公招商银行储蓄卡5917", type: "ASSETS", icon: "Bank" },
  { name: "Assets:Bank:CCBC:Hubby:老公建设银行储蓄卡5137", type: "ASSETS", icon: "Bank" },
  { name: "Assets:Bank:ABC:Wife:老婆农业银行储蓄卡", type: "ASSETS", icon: "Bank" },
  { name: "Assets:Bank:ZXBank:Wife:老婆中信银行储蓄卡", type: "ASSETS", icon: "Bank" },

  // ── Assets: 互联网支付 ──
  { name: "Assets:EBank:Wechat:Hubby:老公微信零钱", type: "ASSETS", icon: "WxPay" },
  { name: "Assets:EBank:AliPay:Hubby:老公支付宝余额", type: "ASSETS", icon: "AliPay" },
  { name: "Assets:EBank:Wechat:Wife:老婆微信零钱", type: "ASSETS", icon: "WxPay" },
  { name: "Assets:EBank:AliPay:Wife:老婆支付宝余额", type: "ASSETS", icon: "AliPay" },
  { name: "Assets:EBank:Wechat:Investment:微信零钱通", type: "ASSETS", icon: "WxPay" },
  { name: "Assets:EBank:AliPay:Investment:支付宝余额宝", type: "ASSETS", icon: "AliPay" },
  { name: "Assets:EBank:JdPay:Hubby:老公京东余额", type: "ASSETS", icon: "JD" },
  { name: "Assets:EBank:JdPay:Wife:老婆京东余额", type: "ASSETS", icon: "JD" },
  { name: "Assets:EBank:JdPay:Investment:京东小金库", type: "ASSETS", icon: "JD" },
  { name: "Assets:Prepaid:预充值", type: "ASSETS", icon: "Cash" },

  // ── Assets: 福利 / 社保 / 公积金 ──
  { name: "Assets:Benefits:Zhigongpuhui:Hubby:老公职工普惠", type: "ASSETS", icon: "Bonus" },
  { name: "Assets:Benefits:Zhigongpuhui:Wife:妻子职工普惠", type: "ASSETS", icon: "Bonus" },
  { name: "Assets:Benefits:DongfangBirthCard:Hubby:老公东方生日汇", type: "ASSETS", icon: "Bonus" },
  { name: "Assets:Benefits:HXT:Hubby:老公和信通", type: "ASSETS", icon: "Bonus" },
  { name: "Assets:SocialSecurity:Hubby:老公医保账户", type: "ASSETS", icon: "Insurance" },
  { name: "Assets:SocialSecurity:Wife:妻子医保账户", type: "ASSETS", icon: "Insurance" },
  { name: "Assets:Insurance:Hubby:老公商业医保账户", type: "ASSETS", icon: "Insurance" },
  { name: "Assets:HouseProvidingFund:Hubby:老公公积金账户", type: "ASSETS", icon: "House" },
  { name: "Assets:HouseProvidingFund:Wife:妻子公积金账户", type: "ASSETS", icon: "House" },

  // ── Assets: 投资 / 固定资产 ──
  { name: "Assets:Investment:Fund:基金投资账户", type: "ASSETS", icon: "Fund" },
  { name: "Assets:Investment:FixedDeposit:大额存单", type: "ASSETS", icon: "Bank" },
  { name: "Assets:Investment:Stocks:股票", type: "ASSETS", icon: "Stock" },
  { name: "Assets:Fixed:RealEstate:家庭名下房产", type: "ASSETS", icon: "House" },
  { name: "Assets:Fixed:Car:家庭名下汽车", type: "ASSETS", icon: "Car" },

  // ── Liabilities: 信用卡 / 房贷 / 花呗白条 ──
  { name: "Liabilities:CreditCard:XYBank:兴业银行信用卡", type: "LIABILITIES", icon: "CreditCard" },
  { name: "Liabilities:CreditCard:HXBank:华夏银行信用卡", type: "LIABILITIES", icon: "CreditCard" },
  { name: "Liabilities:CreditCard:CMB1:招商银行信用卡2945", type: "LIABILITIES", icon: "CreditCard" },
  { name: "Liabilities:CreditCard:CMB2:招商银行信用卡5231", type: "LIABILITIES", icon: "CreditCard" },
  { name: "Liabilities:CreditCard:CITIC:中信银行信用卡1997", type: "LIABILITIES", icon: "CreditCard" },
  { name: "Liabilities:CreditCard:GFBank:广发银行信用卡5059", type: "LIABILITIES", icon: "CreditCard" },
  { name: "Liabilities:CreditCard:ICBC:工商银行信用卡3010", type: "LIABILITIES", icon: "CreditCard" },
  { name: "Liabilities:Mortgage:CITIC:中信银行房贷3346", type: "LIABILITIES", icon: "House" },
  { name: "Liabilities:AliPay:Huabei:Hubby:老公支付宝花呗", type: "LIABILITIES", icon: "Huabei" },
  { name: "Liabilities:AliPay:Huabei:Wife:妻子支付宝花呗", type: "LIABILITIES", icon: "Huabei" },
  { name: "Liabilities:JdPay:Baitiao:Hubby:老公京东白条", type: "LIABILITIES", icon: "JD" },
  { name: "Liabilities:JdPay:Baitiao:Wife:妻子京东白条", type: "LIABILITIES", icon: "JD" },

  // ── Income ──
  { name: "Income:Salary:Hubby:Base:老公工资", type: "INCOME", icon: "Salary" },
  { name: "Income:Salary:Hubby:Bonus:老公绩效", type: "INCOME", icon: "Bonus" },
  { name: "Income:Salary:Hubby:YearEnd:老公年终奖", type: "INCOME", icon: "Bonus" },
  { name: "Income:Salary:Wife:Base:妻子工资", type: "INCOME", icon: "Salary" },
  { name: "Income:Salary:Wife:Bonus:妻子绩效", type: "INCOME", icon: "Bonus" },
  { name: "Income:Salary:Wife:YearEnd:妻子年终奖", type: "INCOME", icon: "Bonus" },
  { name: "Income:Wechat:Hubby:老公微信转账红包", type: "INCOME", icon: "WxPay" },
  { name: "Income:Wechat:Wife:妻子微信转账红包", type: "INCOME", icon: "WxPay" },
  { name: "Income:AliPay:Hubby:老公支付宝转账红包", type: "INCOME", icon: "AliPay" },
  { name: "Income:AliPay:Wife:妻子支付宝转账红包", type: "INCOME", icon: "AliPay" },
  { name: "Income:Investment:Fund:基金收益", type: "INCOME", icon: "Fund" },
  { name: "Income:Investment:Stocks:股票收益", type: "INCOME", icon: "Stock" },
  { name: "Income:Benefits:HolidayVouchers:节假日电子福利券", type: "INCOME", icon: "Bonus" },
  { name: "Income:SocialSecurity:Hubby:老公医保入账", type: "INCOME", icon: "Insurance" },
  { name: "Income:SocialSecurity:Wife:妻子医保入账", type: "INCOME", icon: "Insurance" },
  { name: "Income:Insurance:Hubby:老公商业医保入账", type: "INCOME", icon: "Insurance" },
  { name: "Income:HouseProvidingFund:Hubby:老公公积金入账", type: "INCOME", icon: "House" },
  { name: "Income:HouseProvidingFund:Wife:妻子公积金入账", type: "INCOME", icon: "House" },
  { name: "Income:Other:其他收入", type: "INCOME", icon: "Bonus" },

  // ── Expenses: 日常生活 ──
  { name: "Expenses:DailyLiving:Meals:餐饮（早午晚）", type: "EXPENSES", icon: "Meal" },
  { name: "Expenses:DailyLiving:Groceries:食品杂货（菜米面粮油）", type: "EXPENSES", icon: "Shopping" },
  { name: "Expenses:DailyLiving:Utilities:Electric:电费", type: "EXPENSES", icon: "House" },
  { name: "Expenses:DailyLiving:Utilities:Gas:燃气费", type: "EXPENSES", icon: "House" },
  { name: "Expenses:DailyLiving:Utilities:Property:物业费", type: "EXPENSES", icon: "House" },
  { name: "Expenses:DailyLiving:Utilities:Telecom:手机通讯费", type: "EXPENSES", icon: "Phone" },
  { name: "Expenses:DailyLiving:Healthcare:医疗（大人宝宝）", type: "EXPENSES", icon: "Insurance" },
  { name: "Expenses:DailyLiving:Subscriptions:电子订阅服务", type: "EXPENSES", icon: "Subscribe" },

  // ── Expenses: 交通 ──
  { name: "Expenses:Transportation:Public:公共交通（地铁公交）", type: "EXPENSES", icon: "Bus" },
  { name: "Expenses:Transportation:Bike:共享单车（月季年卡）", type: "EXPENSES", icon: "Bike" },
  { name: "Expenses:Transportation:Car:Fuel:加油", type: "EXPENSES", icon: "Car" },
  { name: "Expenses:Transportation:Car:Parking:停车费", type: "EXPENSES", icon: "Car" },
  { name: "Expenses:Transportation:Car:Maintenance:保养维修", type: "EXPENSES", icon: "Car" },
  { name: "Expenses:Transportation:Car:Insurance:车险", type: "EXPENSES", icon: "Insurance" },
  { name: "Expenses:Transportation:Car:Inspection:年检", type: "EXPENSES", icon: "Car" },

  // ── Expenses: 家庭与代际 ──
  { name: "Expenses:Family:Kids:Tao:陶陶（衣物玩具学费等）", type: "EXPENSES", icon: "Baby" },
  { name: "Expenses:Family:Kids:Tian:添添（衣物玩具学费等）", type: "EXPENSES", icon: "Baby" },
  { name: "Expenses:Family:Parents:孝敬双方父母", type: "EXPENSES", icon: "Family" },
  { name: "Expenses:Family:Childcare:Salary:丈母娘看护工资", type: "EXPENSES", icon: "Salary" },
  { name: "Expenses:Family:Childcare:Living:丈母娘生活补贴（菜药衣）", type: "EXPENSES", icon: "Family" },
  { name: "Expenses:Family:Clothing:成人衣物", type: "EXPENSES", icon: "Clothes" },

  // ── Expenses: 保险 ──
  { name: "Expenses:Insurance:Adults:夫妻保险", type: "EXPENSES", icon: "Insurance" },
  { name: "Expenses:Insurance:Kids:宝宝保险", type: "EXPENSES", icon: "Insurance" },
  { name: "Expenses:Insurance:Parents:父母保险", type: "EXPENSES", icon: "Insurance" },

  // ── Expenses: 娱乐人情 ──
  { name: "Expenses:Entertainment:Dining:外出吃饭", type: "EXPENSES", icon: "Meal" },
  { name: "Expenses:Entertainment:Leisure:娱乐游玩", type: "EXPENSES", icon: "Movie" },
  { name: "Expenses:Entertainment:Social:人情往来（红包份子）", type: "EXPENSES", icon: "Gift" },

  // ── Expenses: 耐用家居 / 维修 ──
  { name: "Expenses:HouseholdGoods:Kitchen:厨房用品", type: "EXPENSES", icon: "Shopping" },
  { name: "Expenses:HouseholdGoods:PersonalCare:个人洗护", type: "EXPENSES", icon: "Shopping" },
  { name: "Expenses:HouseholdGoods:Digital:数码电子", type: "EXPENSES", icon: "Digital" },
  { name: "Expenses:HouseholdGoods:Furniture:家具家电", type: "EXPENSES", icon: "House" },
  { name: "Expenses:HouseholdGoods:Bedding:家纺", type: "EXPENSES", icon: "House" },
  { name: "Expenses:Household:Repair:家庭维修保养", type: "EXPENSES", icon: "Repair" },

  // ── Expenses: 住房金融 / 税务 / 专业 ──
  { name: "Expenses:Housing:MortgageInterest:房贷利息", type: "EXPENSES", icon: "House" },
  { name: "Expenses:Tax:Salary:Hubby:老公工资个税", type: "EXPENSES", icon: "Tax" },
  { name: "Expenses:Tax:Salary:Wife:妻子工资个税", type: "EXPENSES", icon: "Tax" },
  { name: "Expenses:Tax:Other:其他税", type: "EXPENSES", icon: "Tax" },
  { name: "Expenses:Professional:Learning:书籍课程服务器", type: "EXPENSES", icon: "Book" },
  { name: "Expenses:Professional:Hardware:副业硬件", type: "EXPENSES", icon: "Digital" },
  { name: "Expenses:Other:未分类支出", type: "EXPENSES", icon: "Snack" },

  // ── Equity ──
  { name: "Equity:OpeningBalances", type: "EQUITY", icon: "OpeningBalances" },
];

/** 导入兜底：未匹配规则时使用的账户全名 */
export const FALLBACK_ASSET = "Assets:EBank:Wechat:Hubby:老公微信零钱";
export const FALLBACK_EXPENSE = "Expenses:Other:未分类支出";
export const FALLBACK_INCOME = "Income:Other:其他收入";

/** 手动记账默认预选 */
export const DEFAULT_MANUAL_ASSET = "Assets:EBank:Wechat:Hubby:老公微信零钱";
export const DEFAULT_MANUAL_EXPENSE = "Expenses:DailyLiving:Meals:餐饮（早午晚）";
export const DEFAULT_MANUAL_INCOME = "Income:Salary:Hubby:Base:老公工资";

/** 渠道 → 默认资产/支付账户名（用于导入兜底） */
export const CHANNEL_DEFAULT_ASSET: Partial<Record<string, string>> = {
  alipay: "Assets:EBank:AliPay:Hubby:老公支付宝余额",
  wechat: "Assets:EBank:Wechat:Hubby:老公微信零钱",
  jd: "Assets:EBank:JdPay:Hubby:老公京东余额",
  icbc_credit_eml: "Liabilities:CreditCard:ICBC:工商银行信用卡3010",
  cmb_credit_eml: "Liabilities:CreditCard:CMB1:招商银行信用卡2945",
  cgb_credit_eml: "Liabilities:CreditCard:GFBank:广发银行信用卡5059",
  cmb_debit_pdf: "Assets:Bank:CMB:Hubby:老公招商银行储蓄卡5917",
  cmb_debit_txt: "Assets:Bank:CMB:Hubby:老公招商银行储蓄卡5917",
  bocom_debit_pdf: "Assets:Bank:Traffic:Hubby:老公交通银行储蓄卡5535",
  ccb_debit_xls: "Assets:Bank:CCBC:Hubby:老公建设银行储蓄卡5137",
  icbc_debit_pdf: "Assets:Bank:ICBC:Wife:妻子工商银行储蓄卡8138",
};

/** 账户大类中文标签（按路径前缀匹配，长前缀优先） */
export const ACCOUNT_GROUP_LABELS: Record<string, string> = {
  "Assets:Bank": "银行卡",
  "Assets:EBank": "互联网",
  "Assets:Prepaid": "预充值",
  "Assets:Benefits": "福利",
  "Assets:SocialSecurity": "医保",
  "Assets:Insurance": "保险账户",
  "Assets:Fixed": "固定资产",
  "Assets:Investment": "投资",
  "Assets:HouseProvidingFund": "公积金",
  "Expenses:DailyLiving": "日常生活",
  "Expenses:Transportation": "交通出行",
  "Expenses:Family": "家庭",
  "Expenses:Insurance": "保险支出",
  "Expenses:Entertainment": "娱乐及人情",
  "Expenses:HouseholdGoods": "耐用消耗品",
  "Expenses:Household": "家庭维护",
  "Expenses:Housing": "住房",
  "Expenses:Tax": "个税",
  "Expenses:Professional": "学习及副业",
  "Expenses:Other": "未分类",
  "Income:Salary": "工作收入",
  "Income:Wechat": "微信收入",
  "Income:AliPay": "支付宝收入",
  "Income:Investment": "投资收入",
  "Income:Benefits": "福利收入",
  "Income:SocialSecurity": "医保收入",
  "Income:Insurance": "保险收入",
  "Income:HouseProvidingFund": "公积金收入",
  "Income:Other": "其他收入",
  "Liabilities:CreditCard": "信用卡",
  "Liabilities:Mortgage": "房贷",
  "Liabilities:AliPay": "花呗",
  "Liabilities:JdPay": "白条",
  "Equity:OpeningBalances": "期初余额",
};
