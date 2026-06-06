/**
 * constants.js — App-wide immutable data.
 *
 * Extracted from index.html global scope to eliminate magic values
 * scattered throughout the codebase.  All consuming modules import
 * exactly what they need.
 */

// ── ISO 4217 FX rates (mid-2025, units per 1 USD) ───────────────────────
export const FX = Object.freeze({
  // Majors
  USD: 1,     EUR: 0.92,   GBP: 0.79,   JPY: 149.5,  CHF: 0.88,
  // North America
  CAD: 1.36,  MXN: 17.2,
  // Oceania
  AUD: 1.51,  NZD: 1.64,   FJD: 2.25,   PGK: 3.90,   TOP: 2.36,  WST: 2.74,  XPF: 109,
  // Greater China & East Asia
  CNY: 7.23,  HKD: 7.81,   TWD: 31.5,   KRW: 1330,   MOP: 8.05,  MNT: 3400,
  // SE Asia
  SGD: 1.34,  THB: 35.5,   MYR: 4.65,   IDR: 15700,  PHP: 56.5,  VND: 24800,
  BND: 1.34,  KHR: 4100,   LAK: 21800,  MMK: 2100,
  // South Asia
  INR: 83.12, PKR: 278,    BDT: 110,    LKR: 305,    NPR: 133,   AFN: 70,
  // Central Asia
  KZT: 480,   UZS: 12700,  KGS: 87,     TJS: 10.6,   TMT: 3.50,
  // Europe (non-EUR)
  SEK: 10.45, NOK: 10.65,  DKK: 6.85,   ISK: 137,
  PLN: 4.02,  CZK: 22.7,   HUF: 360,    RON: 4.55,   BGN: 1.80,
  RSD: 108,   MKD: 56.8,   ALL: 93,     BAM: 1.80,   MDL: 17.7,
  UAH: 39,    RUB: 92,     BYN: 3.27,
  GEL: 2.65,  AMD: 392,    AZN: 1.70,   TRY: 32.5,
  // Middle East
  AED: 3.673, SAR: 3.75,   QAR: 3.64,   BHD: 0.376,  KWD: 0.308, OMR: 0.385, JOD: 0.709,
  ILS: 3.65,  EGP: 48.5,   LBP: 89500,  IRR: 42000,  IQD: 1310,  YER: 250,   SYP: 13000,
  // Africa
  ZAR: 18.65, KES: 130,    NGN: 1500,   GHS: 14.8,   MAD: 9.95,  TND: 3.12,  DZD: 134,
  ETB: 116,   UGX: 3760,   TZS: 2520,   RWF: 1350,   ZMW: 26.5,  MWK: 1735,  BWP: 13.65,
  MUR: 46.3,  NAD: 18.65,  XOF: 605,    XAF: 605,    LYD: 4.85,  SDG: 600,
  // Latin America & Caribbean
  BRL: 5.05,  ARS: 980,    CLP: 935,    COP: 4150,   PEN: 3.78,  UYU: 39.5,  PYG: 7400,
  BOB: 6.91,  VES: 36,     DOP: 58.5,   GTQ: 7.78,   HNL: 24.7,  JMD: 156,   TTD: 6.77,
  BBD: 2.0,   BSD: 1.0,    BMD: 1.0,    NIO: 36.8,   PAB: 1.0,   HTG: 132,   CRC: 510,
  GYD: 209,
});

export const CURRENCIES = Object.freeze(Object.keys(FX).sort());

/** Currencies whose minor unit equals the major unit (no decimal places). */
export const ZERO_DECIMAL = Object.freeze(new Set([
  'JPY','KRW','VND','CLP','PYG','ISK','RWF','UGX','XAF','XOF','XPF',
]));

/** Currencies where 1 major unit = 1000 minor units (three decimal places). */
export const THREE_DECIMAL = Object.freeze(new Set([
  'BHD','IQD','JOD','KWD','LYD','OMR','TND',
]));

// ── Hijri calendar ─────────────────────────────────────────────────────
export const HIJRI_MONTHS_LONG = Object.freeze([
  'Moharram al-Haraam','Safar al-Muzaffar','Rabi al-Awwal','Rabi al-Aakhar',
  'Jumada al-Ula','Jumada al-Ukhra','Rajab al-Asab','Shabaan al-Karim',
  'Ramadaan al-Moazzam','Shawwal al-Mukarram','Zilqadah al-Haraam','Zilhaj al-Haraam',
]);

export const HIJRI_MONTHS_SHORT = Object.freeze([
  'Moharram','Safar','Rabi I','Rabi II','Jumada I','Jumada II',
  'Rajab','Shabaan','Ramadaan','Shawwal','Zilqadah','Zilhaj',
]);

export const HIJRI_KABISA_REM   = Object.freeze([2,5,8,10,13,16,19,21,24,27,29]);
export const HIJRI_DAYS_IN_YEAR = Object.freeze([30,59,89,118,148,177,207,236,266,295,325]);
export const HIJRI_DAYS_IN_30   = Object.freeze([
  354,708,1063,1417,1771,2126,2480,2834,3189,3543,3898,4252,4606,4961,
  5315,5669,6024,6378,6732,7087,7441,7796,8150,8504,8859,9213,9567,9922,10276,10631,
]);

// ── Miqaat data (Dawoodi Bohra calendar) ────────────────────────────────
// Key: "${hijriMonth}-${hijriDay}" (month is 0-based, day is 1-based).
// p = priority: 1 = major, 2 = significant, 3 = minor.
export const MIQAATS = Object.freeze({
  "0-1":[{"t":"Hijri New Year","p":1},{"t":"Urus Mawlai Abdullah Saheb","p":3}],"0-2":[{"t":"Urus Mawlai Raj Bin Mawlai Hasan Saheb","p":3},{"t":"Urus Syedi Khanji Fir Saheb","p":3},{"t":"Urus Syedi Shaikh Pir Jamaluddin","p":3}],"0-6":[{"t":"Urus Syedi Mohammed Bin Qazikhan","p":3}],"0-7":[{"t":"Urus Syedna Ismail Badruddin (AQ)","p":1}],"0-10":[{"t":"Yawme Ashura","p":1},{"t":"Shahadat Imam Hussain (SA)","p":1},{"t":"Urus Syedna Zoeb Bin Musa (AQ)","p":1},{"t":"Urus Mawlai Ahmed Saheb","p":3}],"0-11":[{"t":"Suyum Imam Hussain (SA)","p":1}],"0-14":[{"t":"Urus Mawlai Lukmanji Mulla Alibhai Saheb","p":3}],"0-15":[{"t":"Urus Mawlai Nuruddin Saheb","p":3}],"0-16":[{"t":"Urus Syedna Hatim bin Syedna Ibrahim (AQ)","p":1}],"0-17":[{"t":"Shahadat Imam Ali Zainulabedin (SA)","p":1},{"t":"Urus Syedna Ibrahim Vajihuddin (AQ)","p":1},{"t":"Urus Mulla Mohammedali bin Syedi Najam Khan","p":3},{"t":"Urus Mawlai Masud bin Sulaiman","p":3},{"t":"Urus Seven Shahid Sahebo","p":3}],"0-18":[{"t":"Urus Shahid Gani Pir Ibne Dawoodji","p":3}],"0-23":[{"t":"Urus Syedi Hasan Fir Saheb Shahid","p":2},{"t":"Urus Noor Bibi Umme Syedna Yusuf Najmuddin","p":3},{"t":"Urus Fatema Bibi Ukhte Syedna Yusuf Najmuddin","p":3}],"0-24":[{"t":"Urus Syedi Dada Sulemanji","p":3}],"0-27":[{"t":"Urus Syedi Fakhruddin Shahid (AQ)","p":2}],"0-28":[{"t":"Urus Syedi Musaji bin Taj","p":3}],"0-29":[{"t":"Urus Mawlai Hasan Bin Mawlai Adam","p":3}],"1-1":[{"t":"Urus Syedna Ali Bin Syedna Hussain (AQ)","p":1}],"1-3":[{"t":"Urus Syedna Ali Shamsuddin Bin Syedna Abdullah (AQ)","p":1}],"1-4":[{"t":"Urus Syedna Abdul Tayyib Zakiyuddin (AQ)","p":1}],"1-6":[{"t":"Urus Syedi Abdeali Imaduddin","p":3}],"1-8":[{"t":"Urus Syedna Khattab Bin Hasan Hamdani (AQ)","p":1}],"1-9":[{"t":"Urus Syedi Tayyib bs Zainuddin","p":3}],"1-12":[{"t":"Urus Syedna Ahmed Hamiduddin Kirmani (RA)","p":1}],"1-13":[{"t":"Urus Mawlai Adam bin Sulaimanji","p":3}],"1-14":[{"t":"Urus Kaka Akela - Kaki Akeli","p":3},{"t":"Urus Mawlai Noorbhai Saheb","p":3}],"1-15":[{"t":"Urus Syedi Hamza Bhaisaheb","p":3}],"1-17":[{"t":"Urus Mawlai Shaikh Saheb bin Sulaimanji","p":3},{"t":"Urus Syedi Shaikh Ibrahim","p":3},{"t":"Urus Shaikh AbdulHusain Shahid","p":3}],"1-20":[{"t":"Chelum Imam Hussain (SA)","p":1}],"1-22":[{"t":"Urus Syedna Hussain bin Syedna Ali (AQ)","p":1}],"1-27":[{"t":"Urus Syedna Mohammed Izziuddin (AQ)","p":1}],"1-28":[{"t":"Shahadat Imam Hassan (SA)","p":1}],"1-29":[{"t":"Urus Syedi Hasan Zakiyuddin","p":3}],"2-1":[{"t":"Urus Syedi Shaikh Adam Safiyuddin","p":3},{"t":"Urus Syedi Jamaluddin bin Shaikh Adam","p":3}],"2-2":[{"t":"Urus Syedna Abdul Tayyib Zakiyuddin bin Syedna Dawood bin Qutbub Shah (AQ)","p":1}],"2-4":[{"t":"Urus Syedi Habibullah bin Mulla Adamji","p":3}],"2-7":[{"t":"Urus Syedi Shaikh Dawood Bhai Mulla Mehmoodji","p":3},{"t":"Urus Syedi Abdeali Mohyiddin","p":3}],"2-10":[{"t":"Urus Syedna Abdullah Badruddin (AQ)","p":1}],"2-12":[{"t":"Eid Milad un-Nabi (SA)","p":1},{"t":"Urus Ummul Mumineen Amatullah Aaisaheba (QR)","p":2},{"t":"Ayyam al-Ta'abudaat","p":1}],"2-14":[{"t":"Urus Syedi Miaji Mulla Taj Saheb","p":3}],"2-16":[{"t":"Urus Syedna Mohammed Burhanuddin (AQ)","p":1}],"2-22":[{"t":"Urus Syedna Ali bin Hanzala (AQ)","p":1},{"t":"Urus Mawlai Dawood bin Raj Saheb","p":3}],"2-23":[{"t":"Urus Mawlai Raj Saheb","p":3},{"t":"Urus Syedi Qazi Khan bin Ameen Shah","p":3}],"2-25":[{"t":"Urus Syedna Ali Shamsuddin bin Mawlai Hasan (AQ)","p":1}],"2-28":[{"t":"Urus Mohammad bin Hasan Saheb","p":3}],"3-4":[{"t":"Milad Imam uz-Zaman (SA)","p":1}],"3-5":[{"t":"Urus Mia Saheb Maati Bhai Mulla Noor Bhai","p":3},{"t":"Urus Mia Saheb Tayebji Shaikh Shams Khan","p":3}],"3-8":[{"t":"Urus Mawlai Raj bin Mulla Adam Saheb","p":3}],"3-10":[{"t":"Urus Syedi AbdulRasul Shahid","p":3}],"3-14":[{"t":"Urus Syedi Ismailji Shahid bin Abde Musa","p":3}],"3-16":[{"t":"Urus Syedna Jalal Shamsuddin (AQ) bin Hasan","p":1}],"3-20":[{"t":"Milad Dai al-Muqaddas, Syedna Mohammed Burhanuddin (AQ)","p":1},{"t":"Ayyam al-Ta'abudaat","p":1}],"3-22":[{"t":"Urus Syedna Musa Kalimuddin (AQ)","p":1},{"t":"Urus Syedi Mulla Habibullah bin Shaikh Sultanali","p":3}],"3-27":[{"t":"Urus Syedna Dawood Burhanuddin bin Ajab Shah (AQ)","p":1}],"3-28":[{"t":"Urus Kakaji Mulla Isa Bhai","p":3}],"4-1":[{"t":"Urus Syedna Ahmed Al Mukaraam","p":3}],"4-3":[{"t":"Urus Syedi Qazi Khan bin Ali","p":3}],"4-8":[{"t":"Urus Syedi Mulla Wahid Bhaisaheb bin Mulla Ibrahimji","p":3}],"4-10":[{"t":"Shahadat Maulatena Fatema tuz Zahra (SA)","p":1}],"4-11":[{"t":"Urus Mawlai Nooruddin Saheb","p":3}],"4-15":[{"t":"Urus Mawlai Dawood bin Qazi Ahmed","p":3}],"4-17":[{"t":"Urus Syedi Dawood Bhaisaheb Shihabuddin","p":3}],"4-21":[{"t":"Urus Seth Chanda bhai ibne Karim Bhai","p":3}],"4-23":[{"t":"Urus Mulla Jaferji Jiwaji","p":3}],"4-29":[{"t":"Urus Syedi Jivanji bin Shaikh Dawood Bhaisaheb","p":3}],"5-8":[{"t":"Urus Syedi Luqmaanji bin Mulla Habibullah","p":3}],"5-12":[{"t":"Urus Mulla Tayyib Bawa bin Mulla Ibrahimji","p":3}],"5-14":[{"t":"Urus Ganje Shohoda","p":3}],"5-15":[{"t":"Urus Syedna Dawood Burhanuddin (AQ) bin Qutub Shah","p":1},{"t":"Urus Mawlai Ali bhai Shahid","p":3}],"5-18":[{"t":"Urus Syedna Yusuf Najmuddin (AQ)","p":1},{"t":"Urus Mawlai Adam ibne Dawood","p":3},{"t":"Urus Moulai Burhanuddin Ibne Khoj Khan","p":3}],"5-23":[{"t":"Urus Syedna Ismail Badruddin (AQ) bin Mawlai Raj","p":1}],"5-27":[{"t":"Urus Syedna Qutub Khan Qutbuddin Shahid (AQ)","p":1},{"t":"Urus Syedna Lamak bin Malik (RA)","p":1}],"5-28":[{"t":"Urus Syedna Ahmed bin Mubarak (AQ)","p":1},{"t":"Urus Syedna Yahya bin Syedna Lamak (AQ)","p":1}],"5-29":[{"t":"Urus Syedna Mohammed Badruddin (AQ)","p":1},{"t":"Rajab al-Asab Pehli raat","p":1},{"t":"Urus Syedna Qadi Numan bin Mohammed (AQ)","p":1},{"t":"Urus Ajab Busaheba Binte Syedna Qutubuddin Shahid (AQ)","p":3}],"6-1":[{"t":"Rajab al-Asab Pehli taarik","p":1}],"6-2":[{"t":"Urus Mawlai Raj bin Dawood","p":3},{"t":"Urus Bhaiji Bhai Ibne Qazi Bhai","p":3}],"6-4":[{"t":"Urus Syedna Noor Mohammed Nooruddin (AQ)","p":1},{"t":"Urus Syedi Hasanji Badshah","p":3}],"6-7":[{"t":"Urus Syedna Shaikh Adam Safiyuddin (AQ)","p":1}],"6-8":[{"t":"Urus Syedi Saifuddin Saheb","p":3}],"6-12":[{"t":"Urus Syedi Najam Khan bin Syedna Fir Khan Shujahuddin AQ","p":3}],"6-13":[{"t":"Milad Amir ul-Mumineen (SA)","p":1},{"t":"Ayyam ul-Beez","p":1}],"6-14":[{"t":"Ayyam ul-Beez","p":1},{"t":"Urus Syedna Abdul Mutalib Najmuddin (AQ)","p":1},{"t":"Urus Mawlai Yaqub Saheb","p":3}],"6-15":[{"t":"Ayyam ul-Beez","p":1},{"t":"Salaat uz-Zawaal","p":1}],"6-17":[{"t":"Ayyam al-Barakaat ul-Khuldiyah","p":1}],"6-18":[{"t":"Urus Syedna Ali Shamsuddin (AQ)","p":1},{"t":"Ayyam al-Barakaat ul-Khuldiyah","p":1}],"6-19":[{"t":"Urus Syedna Taher Saifuddin (AQ)","p":1},{"t":"Ayyam al-Barakaat ul-Khuldiyah","p":1}],"6-24":[{"t":"Urus Syedi Qamruddin Bhaisaheb bin Syedna Haibatullah Al Muaid (AQ)","p":3}],"6-26":[{"t":"Shab-e-Meraaj","p":1},{"t":"Urus Syedna Abdulqadir Najmuddin (AQ)","p":1}],"6-27":[{"t":"Yawm-al-Maba'th","p":1},{"t":"Urus Syedi Miasaheb Alibhai bin Peeriji","p":3}],"6-29":[{"t":"Urus Syedi Luqmaanji bin Syedi Dawood bhai","p":3}],"7-1":[{"t":"Urus Syedna Hebatullah Muayyadfiddin (AQ)","p":1}],"7-14":[{"t":"Shab-e-Baraat","p":1}],"7-15":[{"t":"Urus Syedna Hasan Badruddin (AQ)","p":1}],"7-16":[{"t":"Urus Syedna Ibrahim bin Husain (AQ)","p":1}],"7-19":[{"t":"Urus Syedi Saleh Bhaisaheb Saifuddin","p":3}],"7-22":[{"t":"Urus Moulatena Hurratul Maleka (RA)","p":1},{"t":"Urus Syedi Shaikhfir bin Dawood Shahid","p":3}],"7-25":[{"t":"Urus Syedi Shams Khan bin Syedi Yusufji","p":3}],"7-29":[{"t":"Ramadaan al-Moazzan Pehli raat","p":1},{"t":"Urus Syedna Ali bin Mawla Mohammed al-Walid (AQ)","p":1},{"t":"Urus Syedi Jiwanji bin Shaikh Dawoodbhai","p":3}],"8-1":[{"t":"Urus Shaikh Dawood Bhaisaheb","p":3}],"8-2":[{"t":"Urus Syedi Wali Bhaisaheb bin Syedi Habibullah","p":3}],"8-4":[{"t":"Urus Syedi Tayyib Bhaisaheb Zainuddin (AQ)","p":3}],"8-8":[{"t":"Urus Syedi Fazal Bhaisaheb Qutubuddin bin Syedna Abdullah (AQ)","p":3}],"8-9":[{"t":"Urus Syedna Abdullah Fakhruddin (AQ)","p":1}],"8-16":[{"t":"Lailat al-Fahdil","p":1},{"t":"Urus Syedi Hebatullah Jamaluddin","p":3}],"8-18":[{"t":"Lailat al-Fahdil","p":1}],"8-19":[{"t":"Shahadat Amir ul-Mumineen (SA)","p":1},{"t":"Urus Syedna Mohammed Ezzuddin (AQ)","p":1}],"8-20":[{"t":"Lailat al-Fahdil","p":1}],"8-21":[{"t":"Wafaat Amir ul-Mumineen (SA)","p":1}],"8-22":[{"t":"Lailat al-Qadr","p":1}],"8-23":[{"t":"Milad Dai az-Zamaan, Syedna Mufaddal Saifuddin (TUS)","p":1}],"8-29":[{"t":"Lailat al-Thala'theen","p":1}],"8-30":[{"t":"Lailat ul-Eid-ul-Fitr","p":1}],"9-1":[{"t":"Yawm al-Eid-ul-Fitr","p":1}],"9-3":[{"t":"Urus Shehzadi Sakina Bhensaheba","p":2}],"9-4":[{"t":"Urus Syedi Yusufji","p":3},{"t":"Urus Syedi Taiyebji Shahid","p":3}],"9-5":[{"t":"Urus Syedi Abdul Qadir Hakimuddin (AQ)","p":1}],"9-6":[{"t":"Urus Syedna Hasan Badruddin (AQ)","p":1}],"9-7":[{"t":"Urus Syedna Mohammed bin Taher (AQ)","p":1}],"9-8":[{"t":"Urus Syedna Abbas bin Syedna Mohammed (AQ)","p":1}],"9-9":[{"t":"Urus Syedna Qasim Khan Zainuddin (AQ)","p":1}],"9-10":[{"t":"Urus Syedna Ibrahim bin Syedna Husain (AQ)","p":1},{"t":"Urus Syedna Husain Husamuddin (AQ)","p":1},{"t":"Urus Syedna Hebatullah Muayyadfiddin Shirazi (AQ)","p":3}],"9-13":[{"t":"Urus Syedi Aminji bin Jalal","p":3}],"9-24":[{"t":"Urus Shaikh Qutub Bhai bin Sulaimanji","p":3}],"9-27":[{"t":"Urus Syedi Abdul Qadir Hakimuddin (AQ)","p":1},{"t":"Urus Mia Saheb Abdeali Waliullah","p":3}],"9-29":[{"t":"Urus Syedi Bawa Mulla Khan Saheb","p":3},{"t":"Urus Syedi Qasim Khan bin Hamza Bhai","p":3},{"t":"Urus Mulla Salehbhai Ibne Najamkhan","p":3}],"10-9":[{"t":"Urus Syedna Fir Khan Shujahuddin (AQ)","p":1}],"10-11":[{"t":"Urus Syedna Ali bin Mohammed Sulayhi (RA)","p":1},{"t":"Urus Syedi Hasan bin Nuh Bharuji","p":3}],"10-12":[{"t":"Urus Syedna Abdul Tayyib Zakiyuddin (AQ)","p":1},{"t":"Urus Syedna Abdeali Saifuddin (AQ)","p":1}],"10-13":[{"t":"Urus Syedna Ali bin Syedna Husain (AQ)","p":1}],"10-15":[{"t":"Urus Syedna Tayyib Zainuddin (AQ)","p":1},{"t":"Urus Bai Saheba Raani Baisaheba (RA)","p":3}],"10-19":[{"t":"Urus Syedna Idris Imaduddin (AQ)","p":1}],"10-21":[{"t":"Urus Syedna Ali Shamsuddin (AQ)","p":1}],"10-22":[{"t":"Urus Syedi Shaikh Sadiq Ali Saheb","p":3}],"10-25":[{"t":"Urus Syedna Ali Shamsuddin bin Syedna Hatim (AQ)","p":1}],"10-27":[{"t":"Zikra Milad","p":1},{"t":"Urus Syedi Yusuf Khan bin Syedi Shams Khan","p":3}],"11-1":[{"t":"Urus Syedna Mohammed bin Syedna Hatim (AQ)","p":1}],"11-6":[{"t":"Urus Syedi Khoj bin Malak","p":3}],"11-9":[{"t":"Yawm ul-Arafa","p":1},{"t":"Lailat al-Eid-al-Adha","p":1}],"11-10":[{"t":"Yawm al-Eid-al-Adha","p":1}],"11-11":[{"t":"Takbira","p":1}],"11-12":[{"t":"Takbira","p":1}],"11-13":[{"t":"Urus Mawlai Feroz bin Ismail","p":3},{"t":"Takbira","p":1}],"11-16":[{"t":"Urus Syedna Yusuf Najmuddin bin Sulaiman (AQ)","p":1},{"t":"Urus Syedi Ishaq Bhaishaeb Jamaluddin (AQ)","p":3}],"11-18":[{"t":"Yawm al-Eid-e-Gadhir-e-Khum","p":1}],"11-27":[{"t":"Urus Syedna Abdul Husain Husamuddin (AQ)","p":1},{"t":"Urus Syedna Mohammed Burhanuddin (AQ)","p":1}],"11-29":[{"t":"Urus Ghanj Shohada","p":3}],
});

// ── Account types ───────────────────────────────────────────────────────
export const ACCOUNT_TYPES = Object.freeze([
  { id: 'cash',    label: 'Cash',        icon: 'wallet'      },
  { id: 'bank',    label: 'Bank',        icon: 'landmark'    },
  { id: 'card',    label: 'Credit Card', icon: 'credit-card' },
  { id: 'savings', label: 'Savings',     icon: 'landmark'    },
  { id: 'invest',  label: 'Investment',  icon: 'trending-up' },
]);

// ── Default categories ──────────────────────────────────────────────────
export const DEFAULT_CATEGORIES = Object.freeze([
  { name: 'Food & Drink',  icon: 'utensils',         color: '#f97316', type: 'expense'  },
  { name: 'Transport',     icon: 'car',              color: '#3b82f6', type: 'expense'  },
  { name: 'Shopping',      icon: 'shopping-bag',     color: '#ec4899', type: 'expense'  },
  { name: 'Health',        icon: 'heart-pulse',      color: '#ef4444', type: 'expense'  },
  { name: 'Housing',       icon: 'home',             color: '#a16207', type: 'expense'  },
  { name: 'Entertainment', icon: 'film',             color: '#8b5cf6', type: 'expense'  },
  { name: 'Bills',         icon: 'receipt',          color: '#0891b2', type: 'expense'  },
  { name: 'Education',     icon: 'graduation-cap',   color: '#10b981', type: 'expense'  },
  { name: 'Salary',        icon: 'banknote',         color: '#22c55e', type: 'income'   },
  { name: 'Freelance',     icon: 'briefcase',        color: '#14b8a6', type: 'income'   },
  { name: 'Savings',       icon: 'landmark',         color: '#06b6d4', type: 'income'   },
  { name: 'Transfer',      icon: 'arrow-right-left', color: '#737373', type: 'transfer' },
]);

// ── Navigation routes ───────────────────────────────────────────────────
export const NAV_ITEMS = Object.freeze([
  { id: 'dashboard',    label: 'Dashboard',         icon: 'layout-dashboard'  },
  { id: 'transactions', label: 'Transactions',      icon: 'arrow-left-right'  },
  { id: 'accounts',     label: 'Accounts',          icon: 'wallet'            },
  { id: 'budgets',      label: 'Budgets',           icon: 'target'            },
  { id: 'debts',        label: 'Debts',             icon: 'hand-coins'        },
  { id: 'calendar',     label: 'Regular Purchases', icon: 'shopping-basket'   },
  { id: 'categories',   label: 'Categories',        icon: 'tags'              },
  { id: 'reports',      label: 'Reports',           icon: 'pie-chart'         },
  { id: 'family',       label: 'Family',            icon: 'users'             },
]);

export const MOBILE_TABS = Object.freeze([
  { id: 'dashboard',    label: 'Home',      icon: 'home'            },
  { id: 'transactions', label: 'Activity',  icon: 'list'            },
  { id: '__add',        label: 'Add',       icon: 'plus-circle'     },
  { id: 'calendar',     label: 'Purchases', icon: 'shopping-basket' },
  { id: '__more',       label: 'More',      icon: 'menu'            },
]);

// ── Transaction sort options ────────────────────────────────────────────
export const TX_SORT_OPTIONS = Object.freeze([
  ['date-desc',   'Newest first'   ],
  ['date-asc',    'Oldest first'   ],
  ['amount-desc', 'Highest amount' ],
  ['amount-asc',  'Lowest amount'  ],
  ['payee-asc',   'Payee A→Z'      ],
  ['payee-desc',  'Payee Z→A'      ],
]);

// ── Family sharing ──────────────────────────────────────────────────────
export const MEMBER_COLORS = Object.freeze([
  '#8b5cf6','#ec4899','#f97316','#10b981','#3b82f6','#ef4444','#14b8a6','#f59e0b',
]);

export const FAMILY_ACCESS_LEVELS = Object.freeze([
  { id: 'view',  label: 'View only',   desc: 'Can see transactions & balances',       color: '#3b82f6', icon: 'eye'          },
  { id: 'add',   label: 'Can add',     desc: 'View + add new transactions',           color: '#10b981', icon: 'plus-circle'  },
  { id: 'edit',  label: 'Can edit',    desc: 'View, add & edit (not delete)',          color: '#f59e0b', icon: 'pencil'       },
  { id: 'full',  label: 'Full access', desc: 'View, add, edit & delete transactions', color: '#ef4444', icon: 'shield-check' },
]);

// ── Account type → Lucide icon ──────────────────────────────────────────
export const ACCOUNT_TYPE_ICONS = Object.freeze({
  cash:    'wallet',
  bank:    'landmark',
  card:    'credit-card',
  savings: 'landmark',
  invest:  'trending-up',
});

// ── Supabase (developer-configured) ────────────────────────────────────
export const APP_SUPABASE_URL = 'https://nvsfxdnnakzfzsrsfftp.supabase.co';
export const APP_SUPABASE_KEY = 'sb_publishable_dBQ3d82_7ktA5tEi2ZAJYg_xqHAAlCn';
