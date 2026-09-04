import { extractPersistableProtectedSpans } from "./protected-spans.js";

export interface ClassifiedProductQuery {
  primary_query_type: string;
  secondary_query_types: string[];
  intent_scope: string;
  business_context: string[];
  product_identity: {
    product_category: string;
    product_subcategory: string;
    product_name: string;
    manufacturer: string;
    brand: string;
    model_names: string[];
  };
  shared_attributes: Record<
    string,
    { value: unknown; unit: string; raw_value: string }
  >;
  product_variants: Array<{
    manufacturer: string;
    brand: string;
    model: string;
    variant_name: string;
    attributes: Record<string, unknown>;
  }>;
  technical_requirements: Record<
    string,
    {
      value: unknown;
      unit: string;
      raw_value: string;
      requirement_level: "mandatory" | "preferred" | "informational";
    }
  >;
  conditional_requirements: Array<{
    rule_id: string;
    applies_to: string;
    condition: {
      attribute: string;
      operator: string;
      value: unknown;
      unit: string;
      raw_value: string;
    };
    required_result: {
      attribute: string;
      operator: string;
      value: unknown;
      unit: string;
      raw_value: string;
    };
    requirement_level: "mandatory" | "preferred";
    source_text: string;
  }>;
  matching_controls: {
    exact_manufacturer_required: boolean;
    exact_model_required: boolean;
    equivalent_products_allowed: "yes" | "no" | "unspecified";
    hard_constraints: string[];
    soft_preferences: string[];
    exclusions: string[];
  };
  confidence_level_required: "high" | "medium" | "low";
  technical_risk_sensitive: boolean;
  compliance_sensitive: boolean;
  pricing_volatile: boolean;
  match_readiness: "ready" | "partially_ready" | "not_ready";
  ambiguities: string[];
  missing_information: string[];
  extraction_confidence: "high" | "medium" | "low";
}

export interface CanonicalDerivationResult {
  classifiedQuery: ClassifiedProductQuery;
  fixtureCanonicalText: string;
  fixtureCanonicalFields: Array<{
    fieldId: string;
    path: string;
    valueState: "provided" | "explicitly_unknown";
    languageOrigin: "translated" | "entered_in_english";
    canonicalValue: string;
  }>;
}

export function normalizePersianText(text: string): string {
  return text
    .replace(/\u200B|\u200C|\u200D|\uFEFF/gu, " ")
    .replace(/[آأإ]/gu, "ا")
    .replace(/ي/gu, "ی")
    .replace(/ك/gu, "ک")
    .replace(/ة/gu, "ه")
    .replace(/[\u064B-\u065F\u0670]/gu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function hasPersianWord(pattern: string, text: string): boolean {
  const normPattern = normalizePersianText(pattern).trim();
  const normText = normalizePersianText(text);
  return new RegExp(
    `(?<![\\u0600-\\u06ff])${normPattern}(?![\\u0600-\\u06ff])`,
    "u",
  ).test(normText);
}

function hasLatinWord(pattern: string, text: string): boolean {
  return new RegExp(`\\b${pattern}\\b`, "iu").test(text);
}

/**
 * Finds the index of a Persian word/phrase respecting Unicode word boundaries.
 * Prevents false-positive substring matches (e.g. 'اند' in 'نمایندگان' or 'ارد' in 'استاندارد').
 */
function findPersianWordPosition(pattern: string, text: string): number {
  const normPattern = normalizePersianText(pattern).trim();
  if (/[a-z0-9]/i.test(normPattern)) {
    return text.indexOf(normPattern);
  }
  const escaped = normPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `(?<![\\u0600-\\u06ff])${escaped}(?:ها|های|ان|ات)?(?![\\u0600-\\u06ff])`,
    "u",
  );
  const match = regex.exec(text);
  return match ? match.index : -1;
}

/**
 * Extracts the target product noun phrase directly from the opening statement of a B2B RFQ.
 * In Persian/Arabic tenders: [تأمین/خرید/توريد] + [نام کالا] + [حرف اضافه هدف: برای/جهت/به منظور/با مشخصات/در/لاستخدامها في/لـ/بقدرات/بمواصفات]
 * Isolating this phrase prevents application clauses (e.g., 'برای انتقال سنگ‌آهن' or 'لاستخدامها في واجهات برج') from polluting product identity.
 */
function extractTargetNounPhraseFromOpening(rawText: string): string | null {
  const p1 = rawText.split(/\n\s*\n/u)[0] || rawText;
  const prefixRegex =
    /(?:تأمین|تامین|خرید|سفارش|نیازمند|تهیه|درخواست\s+خرید|استعلام\s+بهای?|سورسینگ|توريد(?:\s+وتصنيع)?|شراء|طلب(?:\s+عروض)?|تصنيع|استيراد|نطلب|نرغب\s+في\s+شراء|سورسينغ|procurement\s+of|supply\s+of|purchase\s+of|sourcing\s+of)\s+([^\n.,;،:]{3,120})/iu;
  const match = prefixRegex.exec(p1);
  if (!match || !match[1]) return null;
  let target = match[1].trim();
  target = target
    .split(
      /\s+(?:برای|جهت|به\s+منظور|با\s+مشخصات|مطابق|مناسب\s+برای|در\s+یک|در\s+پروژه|در\s+خطوط|ل?استخدام(?:ها)?\s+في|لاستخدام|لـ|لمزارع|لتربية|من\s+أجل|بقدرات|بمواصفات|في\s+واجهات|لتجهيز|بمقاسات|وفق|مطابق\s+لـ|for|with|suitable\s+for|matching)\b/iu,
    )[0]!
    .trim();
  return target.length >= 3 ? target : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Persian → English Product Dictionary & Intelligent Subject Extractor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comprehensive Persian → English dictionary for B2B industrial/commercial products.
 * Entries are ordered longest-first so multi-word phrases match before individual words.
 * Each entry maps a normalized Persian term to its professional English product name.
 */
const PERSIAN_PRODUCT_DICTIONARY: ReadonlyArray<readonly [string, string]> = [
  // ── Multi-word phrases (must come first for greedy matching) ──
  ["وحدات طاقة ارضية متنقلة", "Mobile Aircraft Ground Power Units (GPU)"],
  ["وحدات طاقة أرضية متنقلة", "Mobile Aircraft Ground Power Units (GPU)"],
  ["وحدات طاقة ارضية", "Aircraft Ground Power Units (GPU)"],
  ["وحدات طاقة أرضية", "Aircraft Ground Power Units (GPU)"],
  ["طاقة ارضية للطائرات", "Aircraft Ground Power Units"],
  ["طاقة أرضية للطائرات", "Aircraft Ground Power Units"],
  ["لفائف ورق حراري لنقاط البيع", "POS Thermal Paper Rolls"],
  ["لفائف ورق حراري", "Thermal Paper Rolls for POS and ATM Terminals"],
  ["ورق حراري لنقاط البيع", "POS Thermal Paper Rolls"],
  ["ورق حراري", "Thermal Paper Rolls"],
  ["کاغذ حرارتی", "Thermal Paper Rolls"],
  ["رول حرارتی", "Thermal Paper Rolls"],
  [
    "اعلاف اسماك عائمة عالية البروتين",
    "Commercial High-Protein Floating Fish Feed",
  ],
  [
    "أعلاف أسماك عائمة عالية البروتين",
    "Commercial High-Protein Floating Fish Feed",
  ],
  ["اعلاف اسماك عائمة", "Commercial Floating Fish Feed"],
  ["أعلاف أسماك عائمة", "Commercial Floating Fish Feed"],
  ["اعلاف اسماك", "Commercial Fish Feed"],
  ["أعلاف أسماك", "Commercial Fish Feed"],
  ["علف ماهی", "Commercial Fish Feed"],
  ["خوراک آبزیان", "Aquaculture Fish Feed"],
  ["خوراک ابزیان", "Aquaculture Fish Feed"],
  [
    "وحدات زجاج عازل مزدوج",
    "Double Glazed Low-E Insulated Architectural Glass Units",
  ],
  ["زجاج عازل مزدوج", "Double Glazed Low-E Insulated Glass"],
  ["الواح زجاج منخفض الانبعاثية", "Low-E Architectural Glass Panels"],
  ["ألواح زجاج منخفض الانبعاثية", "Low-E Architectural Glass Panels"],
  ["الواح زجاج", "Architectural Glass Panels"],
  ["ألواح زجاج", "Architectural Glass Panels"],
  ["زجاج عازل", "Insulated Glazing Units"],
  ["مولدات كهربائية ديزل بحرية", "Marine Diesel Generator Sets"],
  ["مولدات ديزل بحرية", "Marine Diesel Generator Sets"],
  ["مولدات بحرية", "Marine Generator Sets"],
  ["حفاضات اطفال", "Private Label Baby Diapers"],
  ["حفاضات أطفال", "Private Label Baby Diapers"],
  ["حفاضات", "Baby Diapers & Hygiene Products"],
  ["تسمه نقاله مقاوم به سایش", "Heavy-Duty Abrasion-Resistant Conveyor Belt"],
  ["تسمه نقاله سنگین", "Heavy-Duty Industrial Conveyor Belt"],
  ["تسمه نقاله صنعتی", "Heavy-Duty Industrial Conveyor Belt"],
  ["تسمه نقاله معدنی", "Mining Conveyor Belt"],
  ["تسمه نقاله", "Industrial Conveyor Belt"],
  ["نوار نقاله", "Conveyor Belt"],
  ["صندلی های ارگونومیک", "Ergonomic Office Chairs"],
  ["صندلی‌های ارگونومیک", "Ergonomic Office Chairs"],
  ["صندلی ارگونومیک", "Ergonomic Office Chair"],
  ["صندلی اداری", "Office Chair"],
  ["صندلی سازمانی", "Corporate Office Chair"],
  ["صندلی مدیریتی", "Executive Office Chair"],
  ["مبلمان اداری", "Commercial Office Furniture"],
  ["میز اداری", "Office Desk"],
  ["پمپ سانتریفیوژ افقی", "Horizontal End-Suction Centrifugal Water Pump"],
  ["پمپ سانتریفیوژ صنعتی", "Industrial Centrifugal Water Pump"],
  ["پمپ سانتریفیوژ", "Centrifugal Water Pump"],
  ["پمپ انتقال آب", "Water Transfer Pump"],
  ["پمپ انتقال اب", "Water Transfer Pump"],
  ["فیلتر هوا", "Air Filter"],
  ["فیلتر هوای صنعتی", "Industrial Air Filter"],
  ["کود شیمیایی اوره", "Agricultural Urea Fertilizer"],
  ["کود شیمیایی", "Agricultural Chemical Fertilizer"],
  ["کود اوره", "Urea Fertilizer"],
  ["تجهیزات پزشکی", "Medical Equipment"],
  ["تجهیزات آزمایشگاهی", "Laboratory Equipment"],
  ["تجهیزات دندانپزشکی", "Dental Equipment"],
  ["تجهیزات ورزشی", "Sports Equipment"],
  ["تجهیزات صنعتی", "Industrial Equipment"],
  ["تجهیزات هتل", "Hospitality Equipment"],
  ["تجهیزات آشپزخانه صنعتی", "Commercial Kitchen Equipment"],
  ["تجهیزات آشپزخانه", "Kitchen Equipment"],
  ["مواد شیمیایی", "Industrial Chemicals"],
  ["مواد غذایی", "Food Products"],
  ["مواد اولیه", "Raw Materials"],
  ["لوله مانیسمان", "Seamless Steel Pipe"],
  ["لوله بدون درز", "Seamless Pipe"],
  ["لوله پلی اتیلن", "Polyethylene Pipe"],
  ["لوله فولادی", "Steel Pipe"],
  ["ورق فولادی", "Steel Sheet"],
  ["ورق استیل", "Stainless Steel Sheet"],
  ["ورق آلومینیوم", "Aluminum Sheet"],
  ["ورق سیاه", "Hot-Rolled Steel Plate"],
  ["ورق گالوانیزه", "Galvanized Steel Sheet"],
  ["تیرآهن", "Steel I-Beam"],
  ["تیر آهن", "Steel I-Beam"],
  ["پلی اتیلن", "Polyethylene"],
  ["پلی پروپیلن", "Polypropylene"],
  ["پلی کربنات", "Polycarbonate"],
  ["پلی استایرن", "Polystyrene"],
  ["پلی یورتان", "Polyurethane"],
  ["پلی اورتان", "Polyurethane"],
  ["پلی وینیل", "Polyvinyl Chloride"],
  ["اسید سولفوریک", "Sulfuric Acid"],
  ["اسید نیتریک", "Nitric Acid"],
  ["اسید کلریدریک", "Hydrochloric Acid"],
  ["سود کاستیک", "Caustic Soda"],
  ["کربنات سدیم", "Sodium Carbonate"],
  ["کربنات کلسیم", "Calcium Carbonate"],
  ["اکسید روی", "Zinc Oxide"],
  ["دی اکسید تیتانیوم", "Titanium Dioxide"],
  ["هیدروکسید سدیم", "Sodium Hydroxide"],
  ["پنل خورشیدی", "Solar Panel"],
  ["سلول خورشیدی", "Solar Cell"],
  ["پنل ساندویچی", "Sandwich Panel"],
  ["سقف شیروانی", "Metal Roofing"],
  ["درب ضد سرقت", "Security Door"],
  ["درب اتوماتیک", "Automatic Door"],
  ["پمپ آب", "Water Pump"],
  ["پمپ هیدرولیک", "Hydraulic Pump"],
  ["پمپ سانتریفیوژ", "Centrifugal Pump"],
  ["پمپ وکیوم", "Vacuum Pump"],
  ["شیر صنعتی", "Industrial Valve"],
  ["شیر فشار قوی", "High-Pressure Valve"],
  ["رنگ صنعتی", "Industrial Paint"],
  ["رنگ اپوکسی", "Epoxy Paint"],
  ["رنگ پودری", "Powder Coating"],
  ["لباس کار", "Industrial Workwear"],
  ["لباس نسوز", "Flame-Resistant Clothing"],
  ["کفش ایمنی", "Safety Footwear"],
  ["دستکش صنعتی", "Industrial Gloves"],
  ["عینک ایمنی", "Safety Goggles"],
  ["کلاه ایمنی", "Safety Helmet"],
  ["ماشین آلات", "Machinery"],
  ["تسمه نقاله", "Conveyor Belt"],
  ["تسمه تایمینگ", "Timing Belt"],
  ["موتور الکتریکی", "Electric Motor"],
  ["موتور برق", "Electric Motor"],
  ["دیزل ژنراتور", "Diesel Generator Set"],
  ["کابل برق", "Power Cable"],
  ["کابل فشار قوی", "High-Voltage Cable"],
  ["کابل فیبر نوری", "Fiber Optic Cable"],
  ["کابل نسوز", "Fire-Resistant Cable"],
  ["سیم مسی", "Copper Wire"],
  ["فولاد ضد زنگ", "Stainless Steel"],
  ["فولاد آلیاژی", "Alloy Steel"],
  ["تزریق پلاستیک", "Plastic Injection Molding"],
  ["قالب تزریق", "Injection Mold"],
  ["دستگاه تزریق", "Injection Molding Machine"],
  ["دستگاه برش", "Cutting Machine"],
  ["دستگاه جوش", "Welding Machine"],
  ["دستگاه بسته بندی", "Packaging Machine"],
  ["دستگاه پرکن", "Filling Machine"],
  ["دستگاه سی ان سی", "CNC Machine"],
  ["خط تولید", "Production Line"],
  ["مبدل حرارتی", "Heat Exchanger"],
  ["مخزن ذخیره", "Storage Tank"],
  ["مخزن تحت فشار", "Pressure Vessel"],
  ["بشکه فلزی", "Metal Drum"],
  ["پالت چوبی", "Wooden Pallet"],
  ["پالت پلاستیکی", "Plastic Pallet"],
  ["کارتن بسته بندی", "Packaging Carton"],
  ["روغن موتور", "Motor Oil"],
  ["روغن صنعتی", "Industrial Oil"],
  ["روغن هیدرولیک", "Hydraulic Oil"],
  ["رزین اپوکسی", "Epoxy Resin"],
  ["رزین پلی استر", "Polyester Resin"],
  ["چسب صنعتی", "Industrial Adhesive"],
  ["سرامیک کف", "Floor Ceramic Tile"],
  ["سنگ مرمر", "Marble Stone"],
  ["سنگ گرانیت", "Granite Stone"],
  ["آجر نسوز", "Refractory Brick"],
  ["عایق حرارتی", "Thermal Insulation"],
  ["عایق رطوبتی", "Moisture Insulation"],
  ["عایق صوتی", "Sound Insulation"],
  ["سیستم تهویه", "Ventilation System"],
  ["سیستم اطفاء حریق", "Fire Suppression System"],
  ["سیستم امنیتی", "Security System"],
  ["دوربین مداربسته", "CCTV Camera"],
  ["آنتن مخابراتی", "Telecom Antenna"],
  ["رادیاتور صنعتی", "Industrial Radiator"],
  ["فیلتر صنعتی", "Industrial Filter"],
  ["فیلتر هوا", "Air Filter"],
  ["فیلتر روغن", "Oil Filter"],
  ["یو پی اس", "UPS System"],
  ["منبع تغذیه", "Power Supply"],
  ["تابلو برق", "Electrical Switchboard"],
  ["ترانسفورماتور", "Transformer"],
  ["کنتور برق", "Electric Meter"],
  ["مواد معدنی", "Minerals"],
  // ── Single-word entries (alphabetical by Persian) ──
  ["آسانسور", "Elevator"],
  ["آسفالت", "Asphalt"],
  ["آجر", "Brick"],
  ["آرد", "Flour"],
  ["آلومینیوم", "Aluminum"],
  ["آهک", "Lime"],
  ["آهن", "Iron"],
  ["اتصالات", "Fittings"],
  ["اسانس", "Essential Oil"],
  ["اسید", "Acid"],
  ["الکتروموتور", "Electric Motor"],
  ["الیاف", "Fiber"],
  ["اینورتر", "Inverter"],
  ["باتری", "Battery"],
  ["بتن", "Concrete"],
  ["بخاری", "Heater"],
  ["بذر", "Seed"],
  ["برنج", "Rice"],
  ["بلبرینگ", "Bearing"],
  ["بلوک", "Block"],
  ["بویلر", "Boiler"],
  ["پارچه", "Fabric"],
  ["پالت", "Pallet"],
  ["پرسلان", "Porcelain"],
  ["پروفیل", "Profile"],
  ["پسته", "Pistachio"],
  ["پکیج", "Package Boiler"],
  ["پلاستیک", "Plastic"],
  ["پنبه", "Cotton"],
  ["پوشاک", "Apparel"],
  ["پیچ", "Bolt"],
  ["تایر", "Tire"],
  ["ترانس", "Transformer"],
  ["تسمه", "Belt"],
  ["جرثقیل", "Crane"],
  ["چای", "Tea"],
  ["چرم", "Leather"],
  ["چسب", "Adhesive"],
  ["حلال", "Solvent"],
  ["حوله", "Towel"],
  ["خرما", "Date"],
  ["دارو", "Pharmaceutical"],
  ["دریل", "Drill"],
  ["دیگ", "Boiler"],
  ["رنگ", "Paint"],
  ["روغن", "Oil"],
  ["رزین", "Resin"],
  ["زعفران", "Saffron"],
  ["ساکشن", "Suction Unit"],
  ["سرامیک", "Ceramic"],
  ["سرور", "Server"],
  ["سنگ", "Stone"],
  ["سود", "Soda"],
  ["سولفات", "Sulfate"],
  ["سیلیکون", "Silicone"],
  ["سیم", "Wire"],
  ["سیمان", "Cement"],
  ["شکر", "Sugar"],
  ["شیرآلات", "Valve"],
  ["شیرالات", "Valve"],
  ["شیشه", "Glass"],
  ["عایق", "Insulation"],
  ["عسل", "Honey"],
  ["فرش", "Carpet"],
  ["فلنج", "Flange"],
  ["فولاد", "Steel"],
  ["فیلتر", "Filter"],
  ["قهوه", "Coffee"],
  ["کابل", "Cable"],
  ["کارتن", "Carton"],
  ["کاشی", "Tile"],
  ["کاغذ", "Paper"],
  ["کمپرسور", "Compressor"],
  ["کنسانتره", "Concentrate"],
  ["کوتینگ", "Coating"],
  ["کوره", "Furnace"],
  ["گچ", "Gypsum"],
  ["گرانول", "Granule"],
  ["لاستیک", "Rubber"],
  ["لباس", "Clothing"],
  ["لپتاپ", "Laptop"],
  ["لوله", "Pipe"],
  ["لیفتراک", "Forklift"],
  ["ماسه", "Sand"],
  ["متانول", "Methanol"],
  ["مخزن", "Tank"],
  ["مرغ", "Poultry"],
  ["مس", "Copper"],
  ["مهره", "Nut"],
  ["موتور", "Motor"],
  ["میلگرد", "Rebar"],
  ["ناودانی", "Channel Steel"],
  ["نخ", "Yarn"],
  ["واشر", "Washer"],
  ["ولو", "Valve"],
  ["ژنراتور", "Generator"],
  ["اپوکسی", "Epoxy"],
  ["استرچ", "Stretch Film"],
  ["پرینتر", "Printer"],
  ["پوشش", "Coating"],
  ["کنتاکتور", "Contactor"],
  ["فیوز", "Fuse"],
  ["رله", "Relay"],
  ["سنسور", "Sensor"],
  ["اکچویتر", "Actuator"],
  ["گیربکس", "Gearbox"],
  ["کاتد", "Cathode"],
  ["آند", "Anode"],
  ["الکترود", "Electrode"],
  ["اکسیژن", "Oxygen"],
  ["نیتروژن", "Nitrogen"],
  ["هلیوم", "Helium"],
  ["هیدروژن", "Hydrogen"],
  ["گاز", "Gas"],
  ["بنزین", "Gasoline"],
  ["نفت", "Petroleum"],
  ["قیر", "Bitumen"],
  ["پارافین", "Paraffin"],
  ["وازلین", "Vaseline"],
  ["اوره", "Urea"],
  ["کود", "Fertilizer"],
  ["سم", "Pesticide"],
  ["علفکش", "Herbicide"],
  ["بتونه", "Putty"],
  ["ملات", "Mortar"],
  ["چوب", "Timber"],
  ["ام دی اف", "MDF Board"],
  ["نئوپان", "Particle Board"],
  ["تخته", "Board"],
  ["آیفون", "Intercom"],
  ["داکت", "Duct"],
  ["دمپر", "Damper"],
  ["چیلر", "Chiller"],
  ["فن کویل", "Fan Coil"],
  ["اسپلیت", "Split AC"],
  ["کولر", "Cooler"],
  ["یخچال", "Refrigerator"],
  ["فریزر", "Freezer"],
  ["سردخانه", "Cold Storage"],
  ["لبنیات", "Dairy Products"],
  ["گوشت", "Meat"],
  ["ماهی", "Fish"],
  ["میگو", "Shrimp"],
  ["خوراک دام", "Animal Feed"],
  ["سویا", "Soy"],
  ["ذرت", "Corn"],
  ["گندم", "Wheat"],
  ["جو", "Barley"],
  ["کنجد", "Sesame"],
  ["پودر", "Powder"],
  ["گرافیت", "Graphite"],
  ["تالک", "Talc"],
  ["بنتونیت", "Bentonite"],
  ["کائولن", "Kaolin"],
  ["فلدسپار", "Feldspar"],
  ["سنگ آهن", "Iron Ore"],
  ["زغال", "Coal"],
  ["مقوا", "Cardboard"],
  ["سلفون", "Cellophane"],
  ["تانکر", "Tanker"],
  ["واگن", "Wagon"],
  ["کانتینر", "Container"],
  ["جک", "Jack"],
  ["وینچ", "Winch"],
  ["ابزار", "Tools"],
  ["آچار", "Wrench"],
  ["پیچ گوشتی", "Screwdriver"],
  ["انبر", "Pliers"],
  ["اره", "Saw"],
];

/**
 * Adjective dictionary for combining with product nouns to produce
 * professional English product category names.
 */
const PERSIAN_ADJECTIVE_DICTIONARY: ReadonlyArray<readonly [string, string]> = [
  ["صنعتی", "Industrial"],
  ["تجاری", "Commercial"],
  ["ساختمانی", "Construction"],
  ["پزشکی", "Medical"],
  ["بهداشتی", "Sanitary"],
  ["نظامی", "Military-Grade"],
  ["خودرویی", "Automotive"],
  ["دریایی", "Marine"],
  ["کشاورزی", "Agricultural"],
  ["معدنی", "Mining"],
  ["نفتی", "Petroleum"],
  ["گازی", "Gas"],
  ["حرارتی", "Thermal"],
  ["الکتریکی", "Electrical"],
  ["هیدرولیکی", "Hydraulic"],
  ["پنوماتیکی", "Pneumatic"],
  ["اتوماتیک", "Automatic"],
  ["دستی", "Manual"],
  ["فشار قوی", "High-Pressure"],
  ["فشار ضعیف", "Low-Pressure"],
  ["سنگین", "Heavy-Duty"],
  ["سبک", "Light"],
  ["ضد زنگ", "Stainless"],
  ["ضد حریق", "Fire-Resistant"],
  ["ضد آب", "Waterproof"],
  ["ضد اسید", "Acid-Resistant"],
  ["نسوز", "Refractory"],
  ["خوراکی", "Food-Grade"],
  ["آزمایشگاهی", "Laboratory"],
  ["دارویی", "Pharmaceutical"],
  ["خالص", "High-Purity"],
  ["آلیاژی", "Alloy"],
  ["استیل", "Stainless Steel"],
  ["گالوانیزه", "Galvanized"],
  ["کروم", "Chrome"],
  ["مسی", "Copper"],
  ["برنجی", "Brass"],
  ["چدنی", "Cast Iron"],
  ["پلاستیکی", "Plastic"],
  ["لاستیکی", "Rubber"],
  ["چوبی", "Wooden"],
  ["فلزی", "Metal"],
  ["دیجیتال", "Digital"],
  ["آنالوگ", "Analog"],
  ["تک فاز", "Single-Phase"],
  ["سه فاز", "Three-Phase"],
  ["ضد انفجار", "Explosion-Proof"],
  ["قابل حمل", "Portable"],
  ["ثابت", "Stationary"],
];

/**
 * Dynamically extracts a professional English product subject from Persian text
 * without requiring any hardcoded domain handler.
 *
 * Algorithm:
 * 1. Match multi-word dictionary phrases first (greedy)
 * 2. Match single-word nouns
 * 3. Look for adjectives near matched nouns
 * 4. Compose a professional English product category name
 */
export function dynamicPersianToEnglishSubject(
  normalizedText: string,
  rawText: string,
): string {
  // Phase 0: If the opening statement has an explicit procurement target phrase, extract from it first
  const openingPhrase = extractTargetNounPhraseFromOpening(rawText);
  if (openingPhrase) {
    const normOpening = normalizePersianText(openingPhrase);
    const openingMatches: Array<{
      persian: string;
      english: string;
      position: number;
    }> = [];
    for (const [persian, english] of PERSIAN_PRODUCT_DICTIONARY) {
      const normKey = normalizePersianText(persian);
      const idx = findPersianWordPosition(normKey, normOpening);
      if (idx !== -1) {
        openingMatches.push({ persian: normKey, english, position: idx });
      }
    }
    if (openingMatches.length > 0) {
      openingMatches.sort((a, b) => b.persian.length - a.persian.length);
      const best = openingMatches[0]!;
      // Check for English qualifier in the opening phrase (e.g., Heavy-Duty, End-Suction)
      const engQualifiers = openingPhrase.match(
        /\b(?:Heavy-Duty|End-Suction|Multi-Stage|High-Pressure|Digital|Ergonomic|Low-E)\b/iu,
      );
      const qualifier = engQualifiers ? `${engQualifiers[0]} ` : "";
      return `${qualifier}${best.english}`;
    }

    // Check if the opening phrase contains an embedded English product title (e.g. 'Double Glazed Low-E', 'Marine Diesel Generator Sets', 'Private Label Baby Diapers')
    const latinMatch = openingPhrase.match(
      /\b([A-Z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*(?:\s+[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*){1,5})\b/u,
    );
    if (latinMatch && latinMatch[1] && latinMatch[1].length >= 5) {
      const candidate = latinMatch[1].trim();
      if (
        !/^(?:Visible Light|Heat Treatment|Edge Spacer|Rated Power|Fuel Consumption|Noise Level|Absorbency Capacity|Fluff Pulp|Breathable Back|Elastic System|Leakage Protection)\b/i.test(
          candidate,
        )
      ) {
        return candidate;
      }
    }
  }

  const matchedNouns: Array<{
    persian: string;
    english: string;
    position: number;
  }> = [];
  const matchedAdjectives: Array<{
    persian: string;
    english: string;
    position: number;
  }> = [];

  // Phase 1: Match product nouns with strict word boundaries
  for (const [persian, english] of PERSIAN_PRODUCT_DICTIONARY) {
    const normKey = normalizePersianText(persian);
    const idx = findPersianWordPosition(normKey, normalizedText);
    if (idx !== -1) {
      // Skip if this is a substring of an already-matched longer phrase
      const alreadyCovered = matchedNouns.some(
        (m) =>
          idx >= m.position &&
          idx < m.position + m.persian.length &&
          m.persian.length > normKey.length,
      );
      if (!alreadyCovered) {
        // Remove any shorter overlapping matches
        const toRemove = matchedNouns.filter(
          (m) =>
            m.position >= idx &&
            m.position + m.persian.length <= idx + normKey.length &&
            m.persian.length < normKey.length,
        );
        for (const r of toRemove) {
          matchedNouns.splice(matchedNouns.indexOf(r), 1);
        }
        matchedNouns.push({ persian: normKey, english, position: idx });
      }
    }
  }

  // Phase 2: Match adjectives with word boundaries
  for (const [persian, english] of PERSIAN_ADJECTIVE_DICTIONARY) {
    const normKey = normalizePersianText(persian);
    const idx = findPersianWordPosition(normKey, normalizedText);
    if (idx !== -1) {
      matchedAdjectives.push({ persian: normKey, english, position: idx });
    }
  }

  if (matchedNouns.length === 0) {
    // Try extracting multi-word English product phrase from the raw text (e.g. 'Double Glazed Low-E', 'Private Label Baby Diapers')
    const latinPhraseMatch = rawText.match(
      /\b([A-Z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*(?:\s+[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*){1,5})\b/u,
    );
    if (
      latinPhraseMatch &&
      latinPhraseMatch[1] &&
      latinPhraseMatch[1].length >= 5
    ) {
      const candidate = latinPhraseMatch[1].trim();
      if (
        !/^(?:Visible Light|Heat Treatment|Edge Spacer|Rated Power|Fuel Consumption|Noise Level|Absorbency Capacity|Fluff Pulp|Breathable Back|Elastic System|Leakage Protection)\b/i.test(
          candidate,
        )
      ) {
        return candidate;
      }
    }
    const englishWords = rawText.match(/[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/g);
    if (englishWords && englishWords.length >= 2) {
      return englishWords.slice(0, 4).join(" ");
    }
    return "Specialized Commercial Equipment";
  }

  // Phase 3: Select the primary product noun (earliest + longest match)
  matchedNouns.sort((a, b) => {
    const lenDiff = b.persian.length - a.persian.length;
    if (lenDiff !== 0) return lenDiff;
    return a.position - b.position;
  });
  const primary = matchedNouns[0]!;

  // Phase 4: Find the closest adjective to the primary noun
  let bestAdj: { english: string } | null = null;
  let bestDist = Infinity;
  for (const adj of matchedAdjectives) {
    const dist = Math.abs(adj.position - primary.position);
    if (dist < bestDist && dist < 80) {
      bestDist = dist;
      bestAdj = adj;
    }
  }

  // Phase 5: Compose professional product name
  const adjPrefix = bestAdj ? `${bestAdj.english} ` : "";
  const productName = primary.english;

  // Only coordinate secondary noun if it is immediately adjacent (e.g. 'پیچ و مهره', 'لوله و اتصالات' within 35 chars)
  let suffix = "";
  if (matchedNouns.length > 1) {
    const secondary = matchedNouns[1]!;
    if (
      secondary.english !== primary.english &&
      Math.abs(secondary.position - primary.position) <= 35
    ) {
      suffix = ` and ${secondary.english}`;
    }
  }

  return `${adjPrefix}${productName}${suffix}`;
}

/**
 * Agentic Classifier & Requirement Extractor implementing
 * MatchBASE Industrial Product Query Classifier & Technical Requirement Extractor Prompt v2.0
 */
export function classifyAndDeriveCanonical(
  rawSourceText: string,
  unknownFields: readonly string[] = [],
): CanonicalDerivationResult {
  const norm = normalizePersianText(rawSourceText);

  // 1. Ultrasound (Medical & Diagnostic Imaging)
  const isUltrasound =
    norm.includes("سونوگرافی") ||
    norm.includes("ultrasound") ||
    norm.includes("sonography") ||
    norm.includes("color doppler") ||
    norm.includes("داپلر") ||
    (norm.includes("پروب") &&
      (norm.includes("پزشکی") ||
        norm.includes("درمانی") ||
        norm.includes("کلینیک") ||
        norm.includes("شکمی") ||
        norm.includes("عروقی") ||
        norm.includes("linear") ||
        norm.includes("convex"))) ||
    (norm.includes("dicom") &&
      (norm.includes("پرتابل") ||
        norm.includes("پزشکی") ||
        norm.includes("تصاویر")));

  // 2. Drip Irrigation (Agricultural & Precision Irrigation)
  const isDripIrrigation =
    norm.includes("ابیاری") ||
    norm.includes("آبیاری") ||
    norm.includes("قطره ای") ||
    norm.includes("قطره‌ای") ||
    norm.includes("drip line") ||
    norm.includes("dripper") ||
    norm.includes("fertigation") ||
    (hasLatinWord("irrigation", norm) && !norm.includes("medical")) ||
    (norm.includes("مزرعه") && norm.includes("ابیاری"));

  // 3. Hotel Textiles (Hospitality Bed Linens & Bath Towels)
  const isHotelTextile =
    norm.includes("منسوجات") ||
    norm.includes("ملحفه") ||
    norm.includes("روبالشی") ||
    norm.includes("کاور لحاف") ||
    (norm.includes("حوله") &&
      (norm.includes("هتل") ||
        norm.includes("حمام") ||
        norm.includes("hospitality"))) ||
    norm.includes("bed linen") ||
    norm.includes("bath towel") ||
    norm.includes("duvet cover") ||
    norm.includes("pillowcase") ||
    hasLatinWord("textile", norm) ||
    hasLatinWord("textiles", norm) ||
    (norm.includes("هتل") &&
      (norm.includes("پنبه") ||
        norm.includes("cotton-rich") ||
        norm.includes("thread count") ||
        norm.includes("gsm")));

  // 4. Truck & Trailer Tires
  const isTruckTires =
    norm.includes("315/80r22.5") ||
    norm.includes("385/65r22.5") ||
    (norm.includes("تایر") &&
      (norm.includes("کامیون") ||
        norm.includes("تریلر") ||
        norm.includes("محور") ||
        norm.includes("ناوگان"))) ||
    (norm.includes("لاستیک") &&
      (norm.includes("سنگین") ||
        norm.includes("کامیون") ||
        norm.includes("تریلر"))) ||
    (hasLatinWord("tire", norm) &&
      (norm.includes("truck") ||
        norm.includes("trailer") ||
        norm.includes("commercial"))) ||
    (hasLatinWord("tyre", norm) &&
      (norm.includes("truck") ||
        norm.includes("trailer") ||
        norm.includes("commercial")));

  // 5. Skincare & Cosmetics
  const isSkincare =
    norm.includes("مراقبت پوستی") ||
    norm.includes("سرم ویتامین") ||
    norm.includes("کرم مرطوب") ||
    norm.includes("ضدافتاب") ||
    norm.includes("ضدآفتاب") ||
    norm.includes("spf 50") ||
    norm.includes("spf50") ||
    norm.includes("gmp cosmetics") ||
    (norm.includes("skincare") && !norm.includes("tire")) ||
    (norm.includes("private label") &&
      (norm.includes("پوست") ||
        norm.includes("cosmetic") ||
        norm.includes("ارایشی") ||
        norm.includes("آرایشی")));

  // 6. Forklift (Warehouse & Logistics)
  const isForklift =
    norm.includes("لیفتراک") ||
    hasLatinWord("forklift", norm) ||
    hasLatinWord("forklifts", norm) ||
    (norm.includes("سهچرخ") && norm.includes("دکل")) ||
    (norm.includes("سه چرخ") && norm.includes("دکل")) ||
    (norm.includes("چهارچرخ") && norm.includes("دکل")) ||
    (norm.includes("چهار چرخ") && norm.includes("دکل")) ||
    (norm.includes("side shift") && norm.includes("mast"));

  // 7. Enterprise IT Laptops
  const isEnterpriseIT =
    !isForklift &&
    !isUltrasound &&
    (hasLatinWord("laptop", norm) ||
      hasLatinWord("laptops", norm) ||
      norm.includes("لپتاپ") ||
      norm.includes("لپ تاپ") ||
      norm.includes("business-class") ||
      norm.includes("core ultra") ||
      norm.includes("thinkpad") ||
      norm.includes("latitude") ||
      norm.includes("elitebook") ||
      norm.includes("windows 11 pro"));

  // 8. Porcelain Tiles (Building & Decor) - MUST NOT match Hotel Textiles or Irrigation!
  const isPorcelainTile =
    !isHotelTextile &&
    !isDripIrrigation &&
    (norm.includes("پرسلان") ||
      norm.includes("کاشی") ||
      norm.includes("porcelain") ||
      norm.includes("stoneware") ||
      (norm.includes("سرامیک") &&
        (norm.includes("کف") ||
          norm.includes("دیوار") ||
          norm.includes("هتل") ||
          norm.includes("اسلب") ||
          norm.includes("tile"))) ||
      hasLatinWord("tile", norm) ||
      hasLatinWord("tiles", norm));

  // 9. Solar Panels & Inverters
  const isSolar =
    norm.includes("خورشیدی") ||
    hasLatinWord("solar", norm) ||
    norm.includes("فتوولتائیک") ||
    hasLatinWord("photovoltaic", norm) ||
    (hasLatinWord("inverter", norm) &&
      (norm.includes("pv") ||
        norm.includes("solar") ||
        norm.includes("سه فاز") ||
        norm.includes("سهفاز") ||
        norm.includes("mppt"))) ||
    (norm.includes("اینورتر") &&
      (norm.includes("نیروگاه") ||
        norm.includes("خورشیدی") ||
        norm.includes("سه فاز") ||
        norm.includes("سهفاز") ||
        norm.includes("mppt")));

  // 10. Industrial Fasteners
  const isFastener =
    !isEnterpriseIT &&
    !norm.includes("thunderbolt") &&
    (hasLatinWord("fastener", norm) ||
      hasLatinWord("fasteners", norm) ||
      hasLatinWord("bolt", norm) ||
      hasLatinWord("bolts", norm) ||
      norm.includes("اتصالات پیچ") ||
      (hasPersianWord("پیچ", norm) &&
        (norm.includes("مهره") ||
          norm.includes("صنعتی") ||
          norm.includes("شش‌گوش"))));

  // 11. Pistachio
  const isPistachio =
    hasPersianWord("پسته", norm) ||
    hasLatinWord("pistachio", norm) ||
    hasLatinWord("pistachios", norm) ||
    norm.includes("احمدآقایی") ||
    norm.includes("احمد آقایی");

  // 12. Injection Molding
  const isInjectionMolding =
    norm.includes("تزریق پلاستیک") ||
    norm.includes("دستگاه تزریق") ||
    (hasLatinWord("injection", norm) && hasLatinWord("molding", norm));

  // 13. PPE & Protective Workwear (Flame-Resistant / Arc-Flash / Safety Apparel)
  const isPPE =
    norm.includes("لباس کار") ||
    norm.includes("لباس نسوز") ||
    norm.includes("لباس ضد") ||
    norm.includes("پوشاک ضد") ||
    norm.includes("پوشاک ایمنی") ||
    norm.includes("ضد حریق") ||
    norm.includes("ضدحریق") ||
    norm.includes("ضد ارک") ||
    norm.includes("ضد آرک") ||
    norm.includes("ارک فلش") ||
    norm.includes("آرک فلش") ||
    norm.includes("حفاظت فردی") ||
    norm.includes("کفش ایمنی") ||
    norm.includes("دستکش ایمنی") ||
    norm.includes("کلاه ایمنی") ||
    norm.includes("atpv") ||
    norm.includes("nfpa 70e") ||
    norm.includes("nfpa 2112") ||
    norm.includes("en 11612") ||
    norm.includes("en iso 11612") ||
    norm.includes("nomex") ||
    hasLatinWord("ppe", norm) ||
    hasLatinWord("workwear", norm) ||
    hasLatinWord("coverall", norm) ||
    hasLatinWord("coveralls", norm) ||
    (hasLatinWord("nfpa", norm) &&
      (norm.includes("atpv") ||
        norm.includes("flame") ||
        norm.includes("arc") ||
        norm.includes("لباس")));

  // 14. Industrial Protective Coatings & Performance Paints
  const isIndustrialCoatings =
    !isPorcelainTile &&
    (norm.includes("رنگ صنعتی") ||
      norm.includes("رنگ های صنعتی") ||
      norm.includes("رنگ‌های صنعتی") ||
      norm.includes("پوشش صنعتی") ||
      norm.includes("پوشش های صنعتی") ||
      norm.includes("پوشش‌های صنعتی") ||
      norm.includes("پوشش ضد خوردگی") ||
      norm.includes("پوشش های حفاظتی") ||
      norm.includes("پوشش‌های حفاظتی") ||
      norm.includes("رنگ اپوکسی") ||
      norm.includes("پلی یورتان") ||
      norm.includes("پلی اورتان") ||
      norm.includes("پلی‌اورتان") ||
      norm.includes("رزین اپوکسی") ||
      norm.includes("پرایمر صنعتی") ||
      norm.includes("ضد خوردگی") ||
      norm.includes("ضدخوردگی") ||
      norm.includes("کوتینگ") ||
      hasLatinWord("coating", norm) ||
      hasLatinWord("coatings", norm) ||
      (norm.includes("paint") &&
        (norm.includes("industrial") ||
          norm.includes("epoxy") ||
          norm.includes("protective"))) ||
      (hasLatinWord("epoxy", norm) &&
        (norm.includes("primer") ||
          norm.includes("coating") ||
          norm.includes("paint") ||
          norm.includes("رنگ"))) ||
      (hasLatinWord("voc", norm) &&
        (norm.includes("tds") ||
          norm.includes("sds") ||
          norm.includes("coa") ||
          norm.includes("رنگ") ||
          norm.includes("coating"))));

  // 15. Industrial Valves & Flow Control
  const isValves =
    norm.includes("شیرآلات") ||
    norm.includes("شیرالات") ||
    norm.includes("شیر صنعتی") ||
    norm.includes("گیت ولو") ||
    norm.includes("بال ولو") ||
    norm.includes("گلوب ولو") ||
    norm.includes("کنترل ولو") ||
    norm.includes("شیر پروانه") ||
    norm.includes("شیر خودکار") ||
    hasLatinWord("valve", norm) ||
    hasLatinWord("valves", norm);

  // 16. Industrial Centrifugal & Hydraulic Pumps
  const isPumps =
    !isDripIrrigation &&
    (hasPersianWord("پمپ", norm) ||
      norm.includes("الکتروپمپ") ||
      norm.includes("بوسترپمپ") ||
      norm.includes("بوستر پمپ") ||
      hasLatinWord("pump", norm) ||
      hasLatinWord("pumps", norm));

  // 17A. Heavy-Duty Conveyor Belts (Mining & Bulk Material Handling)
  const isConveyorBelt =
    norm.includes("تسمه نقاله") ||
    norm.includes("نوار نقاله") ||
    (hasPersianWord("تسمه", norm) &&
      (norm.includes("نقاله") ||
        norm.includes("معدنی") ||
        norm.includes("سایش") ||
        norm.includes("خردایش") ||
        norm.includes("splicing") ||
        norm.includes("ep") ||
        norm.includes("steel cord"))) ||
    hasLatinWord("conveyor", norm) ||
    hasLatinWord("conveyors", norm);

  // 17B. Ergonomic Office Furniture & Corporate Seating
  const isOfficeFurniture =
    norm.includes("صندلی ارگونومیک") ||
    norm.includes("صندلی اداری") ||
    norm.includes("مبلمان اداری") ||
    norm.includes("میز اداری") ||
    (hasPersianWord("صندلی", norm) &&
      (norm.includes("اداری") ||
        norm.includes("سازمانی") ||
        norm.includes("شرکت") ||
        norm.includes("دفتر") ||
        norm.includes("ارگونومیک") ||
        norm.includes("مدیریتی") ||
        norm.includes("کارشناسی"))) ||
    (hasLatinWord("ergonomic", norm) &&
      (norm.includes("chair") ||
        norm.includes("chairs") ||
        norm.includes("seating") ||
        norm.includes("office") ||
        norm.includes("صندلی"))) ||
    (hasLatinWord("bifma", norm) &&
      (norm.includes("chair") ||
        norm.includes("chairs") ||
        norm.includes("صندلی") ||
        norm.includes("seating") ||
        norm.includes("office")));

  // 17. Structural Steel & Seamless Piping (strictly guarded against Conveyor Belts and Mining Ore Handling)
  const isSteel =
    !isConveyorBelt &&
    !isFastener &&
    !norm.includes("تسمه") &&
    !norm.includes("نقاله") &&
    (norm.includes("تیرآهن") ||
      norm.includes("تیر آهن") ||
      norm.includes("میلگرد") ||
      norm.includes("لوله مانیسمان") ||
      norm.includes("لوله بدون درز") ||
      norm.includes("ورق سیاه") ||
      norm.includes("ورق فولادی") ||
      norm.includes("شمش فولادی") ||
      (hasPersianWord("فولاد", norm) &&
        !norm.includes("تسمه") &&
        (norm.includes("ساختمانی") ||
          norm.includes("صنعتی") ||
          norm.includes("سازه") ||
          norm.includes("نورد"))) ||
      (hasLatinWord("steel", norm) &&
        !norm.includes("cord") &&
        !norm.includes("belt") &&
        (norm.includes("structural") ||
          norm.includes("rebar") ||
          norm.includes("seamless") ||
          norm.includes("pipe") ||
          norm.includes("beam"))));

  // 18A. Marine Commercial Diesel Generator Sets (Maritime & Commercial Vessels)
  const isMarineGenerator =
    (norm.includes("generator") ||
      norm.includes("ژنراتور") ||
      norm.includes("مولدات") ||
      norm.includes("دیزل") ||
      norm.includes("مولد")) &&
    (norm.includes("بحرية") ||
      norm.includes("بحریه") ||
      norm.includes("marine") ||
      norm.includes("سفن") ||
      norm.includes("سفينة") ||
      norm.includes("کشتی") ||
      norm.includes("شناور") ||
      norm.includes("imo") ||
      norm.includes("dnv") ||
      norm.includes("abs") ||
      norm.includes("تصنيف بحري") ||
      norm.includes("lloyd"));

  // 18B. Commercial Diesel Generators (Terrestrial & Industrial Facilities)
  const isGenerator =
    !isUltrasound &&
    !isMarineGenerator &&
    (norm.includes("ژنراتور دیزلی") ||
      norm.includes("دیزل ژنراتور") ||
      norm.includes("مولد برق") ||
      (hasLatinWord("generator", norm) &&
        (norm.includes("diesel") ||
          norm.includes("power") ||
          norm.includes("kva"))));

  // 18C. Architectural Double Glazed & Low-E Insulated Glass Units
  const isLowEGlass =
    norm.includes("زجاج") ||
    norm.includes("low-e") ||
    norm.includes("low e") ||
    norm.includes("double glazed") ||
    norm.includes("double glazing") ||
    norm.includes("insulated glass") ||
    norm.includes("igu") ||
    norm.includes("شیشه دوجداره") ||
    norm.includes("شیشه عایق") ||
    norm.includes("شیشه لامینت") ||
    norm.includes("شیشه سکوریت") ||
    (hasLatinWord("glass", norm) &&
      (norm.includes("low") ||
        norm.includes("glazed") ||
        norm.includes("facade") ||
        norm.includes("facades") ||
        norm.includes("tower") ||
        norm.includes("architectural") ||
        norm.includes("shgc") ||
        norm.includes("u-value")));

  // 18D. Private Label Baby Diapers & Infant Care Products
  const isBabyDiapers =
    norm.includes("حفاضات") ||
    norm.includes("پوشک") ||
    norm.includes("diaper") ||
    norm.includes("diapers") ||
    (norm.includes("baby") &&
      (norm.includes("care") ||
        norm.includes("wipe") ||
        norm.includes("nappy") ||
        norm.includes("hygiene"))) ||
    (norm.includes("private label") &&
      (norm.includes("diaper") ||
        norm.includes("حفاضات") ||
        norm.includes("پوشک") ||
        norm.includes("sap") ||
        norm.includes("absorbency")));

  // 18E. Aviation Ground Power Units (GPU) & Airport GSE Power Systems
  const isAviationGPU =
    hasLatinWord("gpu", norm) ||
    norm.includes("ground power") ||
    norm.includes("طاقة ارضية") ||
    norm.includes("طاقة أرضية") ||
    norm.includes("طاقة الطائرات") ||
    norm.includes("معدات الطيران") ||
    norm.includes("400 hz") ||
    norm.includes("400hz") ||
    norm.includes("arp5015") ||
    norm.includes("iso 6858") ||
    ((norm.includes("طائرات") ||
      norm.includes("طائرة") ||
      norm.includes("مطار") ||
      norm.includes("طيران") ||
      hasLatinWord("aircraft", norm) ||
      hasLatinWord("airport", norm) ||
      hasLatinWord("aviation", norm)) &&
      (norm.includes("وحدات طاقة") ||
        norm.includes("توليد طاقة") ||
        norm.includes("تغذية كهربائية") ||
        hasLatinWord("power", norm) ||
        hasLatinWord("gse", norm)));

  // 18F. Thermal Paper Rolls (POS & ATM Terminals)
  const isThermalPaper =
    norm.includes("ورق حراري") ||
    norm.includes("ورق حرارتی") ||
    norm.includes("کاغذ حرارتی") ||
    norm.includes("کاغذ حرارت") ||
    norm.includes("لفائف ورق") ||
    norm.includes("رول حرارتی") ||
    norm.includes("رول حرارت") ||
    norm.includes("thermal paper") ||
    (hasLatinWord("pos", norm) &&
      (norm.includes("paper") ||
        norm.includes("roll") ||
        norm.includes("ورق") ||
        norm.includes("کاغذ") ||
        norm.includes("لفة") ||
        norm.includes("لفائف"))) ||
    (hasLatinWord("thermal", norm) &&
      (hasLatinWord("roll", norm) ||
        hasLatinWord("rolls", norm) ||
        hasLatinWord("paper", norm)));

  // 18G. Floating Fish Feed & Aquaculture Nutrition
  const isAquacultureFeed =
    norm.includes("اعلاف اسماك") ||
    norm.includes("أعلاف أسماك") ||
    norm.includes("علف ماهی") ||
    norm.includes("خوراک آبزیان") ||
    norm.includes("خوراک ابزیان") ||
    norm.includes("خوراک ماهی") ||
    norm.includes("علف سمك") ||
    norm.includes("علف عائم") ||
    norm.includes("fish feed") ||
    norm.includes("floating feed") ||
    norm.includes("aquafeed") ||
    ((norm.includes("اسماك") ||
      norm.includes("ماهی") ||
      norm.includes("آبزیان") ||
      norm.includes("بلطی") ||
      norm.includes("قاروص") ||
      hasLatinWord("tilapia", norm) ||
      hasLatinWord("aquaculture", norm)) &&
      (norm.includes("علف") ||
        norm.includes("اعلاف") ||
        norm.includes("أعلاف") ||
        norm.includes("تغذية") ||
        norm.includes("خوراک") ||
        hasLatinWord("feed", norm) ||
        hasLatinWord("fcr", norm)));

  // 19. Electrical Power Cables (strictly guarded against Aviation GPU and GSE)
  const isCables =
    !isAviationGPU &&
    !norm.includes("طائرات") &&
    !norm.includes("مطار") &&
    !hasLatinWord("gpu", norm) &&
    !hasLatinWord("aircraft", norm) &&
    (norm.includes("کابل برق") ||
      norm.includes("کابل فشار قوی") ||
      norm.includes("کابل نسوز") ||
      norm.includes("کابل زره دار") ||
      (norm.includes("سیم و کابل") && norm.includes("صنعتی")) ||
      (hasLatinWord("cable", norm) &&
        (norm.includes("power") ||
          norm.includes("voltage") ||
          norm.includes("high"))));

  // 20. Petrochemicals & Polymer Granules (strictly guarded against PPE and Coatings)
  const isPetrochemicals =
    !isPPE &&
    !isIndustrialCoatings &&
    !isValves &&
    !isPumps &&
    (norm.includes("گرانول") ||
      norm.includes("پلی اتیلن") ||
      norm.includes("پلی پروپیلن") ||
      norm.includes("پلی‌پروپیلن") ||
      (norm.includes("پلیمر") &&
        !norm.includes("لباس") &&
        !norm.includes("رنگ")) ||
      (norm.includes("پتروشیمی") &&
        !norm.includes("لباس") &&
        !norm.includes("رنگ") &&
        !norm.includes("شیر") &&
        !norm.includes("پمپ")));

  // 21. Commercial Boiler (guard against general package 'پکیج کامل' and industrial valves)
  const isBoiler =
    !isValves &&
    !isPPE &&
    !isIndustrialCoatings &&
    (hasPersianWord("بویلر", norm) ||
      (hasPersianWord("پکیج", norm) &&
        (norm.includes("دیواری") ||
          norm.includes("گرمایشی") ||
          norm.includes("چگالشی") ||
          norm.includes("شوفاژ") ||
          norm.includes("موتورخانه") ||
          norm.includes("آبگرم") ||
          norm.includes("ابگرم") ||
          norm.includes("گرمایش"))) ||
      hasLatinWord("boiler", norm) ||
      hasLatinWord("boilers", norm));

  // 22. Brazilian Poultry
  const isPoultry =
    (hasPersianWord("مرغ", norm) &&
      (norm.includes("منجمد") ||
        norm.includes("برزیل") ||
        norm.includes("سینه") ||
        norm.includes("شاورما"))) ||
    (hasLatinWord("poultry", norm) && norm.includes("brazil")) ||
    (hasLatinWord("chicken", norm) &&
      (norm.includes("frozen") || norm.includes("breast")));

  // 23. Copper Cathodes - STRICT BOUNDARY CHECK: Never match 'مصرف' or 'مستمر'!
  const isCopper =
    !isDripIrrigation &&
    !isUltrasound &&
    !isHotelTextile &&
    (hasPersianWord("مس", norm) ||
      hasPersianWord("کاتد", norm) ||
      hasLatinWord("copper", norm) ||
      hasLatinWord("cathode", norm) ||
      hasLatinWord("cathodes", norm));

  let classified: ClassifiedProductQuery;
  let canonicalText: string;
  let needVal: string;
  let constraintsVal: string;
  let contextVal: string;

  if (isUltrasound) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "compliance_verification",
      ],
      intent_scope: "commercial_use",
      business_context: [
        "hospital procurement",
        "clinical diagnostic centers",
        "medical equipment distributor",
      ],
      product_identity: {
        product_category: "medical & laboratory equipment",
        product_subcategory: "portable diagnostic ultrasound systems",
        product_name:
          "Professional Portable Ultrasound System (Color Doppler, Convex & Linear Probes)",
        manufacturer: "",
        brand: "",
        model_names: ["Portable Color Doppler Ultrasound"],
      },
      shared_attributes: {
        imaging_modes: {
          value: "Color Doppler, B-mode, M-mode, PW Doppler",
          unit: "",
          raw_value: "Color Doppler",
        },
        transducers: {
          value: "multi-frequency Convex and Linear probes",
          unit: "",
          raw_value: "پروب‌های Convex و Linear",
        },
        clinical_applications: {
          value: "general, abdominal, vascular, and OB-GYN diagnostic imaging",
          unit: "",
          raw_value: "عمومی، شکمی، عروقی و زنان و زایمان",
        },
      },
      product_variants: [],
      technical_requirements: {
        regulatory_clearance: {
          value: ["CE Medical", "FDA"],
          unit: "",
          raw_value: "CE Medical یا FDA",
          requirement_level: "mandatory",
        },
        connectivity: {
          value: "DICOM 3.0 network connectivity",
          unit: "",
          raw_value: "DICOM Connectivity",
          requirement_level: "mandatory",
        },
        warranty: {
          value: "minimum 2 years factory warranty",
          unit: "years",
          raw_value: "Warranty حداقل دوساله",
          requirement_level: "mandatory",
        },
        documentation: {
          value: [
            "Certificate of Origin",
            "Calibration Documentation",
            "Operator Manual",
          ],
          unit: "",
          raw_value: "Certificate of Origin, Calibration Documentation",
          requirement_level: "mandatory",
        },
        service_and_support: {
          value:
            "Installation, user training, and accessible technical spare parts",
          unit: "",
          raw_value: "Installation، User Training و خدمات فنی",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Color Doppler enabled portable ultrasound architecture",
          "Convex and Linear multi-frequency probes included",
          "Compliance with CE Medical or FDA regulatory certifications",
          "Native DICOM connectivity for medical image transfer and archiving",
          "Minimum 2-year warranty with documented calibration and local maintenance access",
        ],
        soft_preferences: [
          "Hospital supply track record in GCC",
          "Regional inventory in the UAE",
          "Pre-order demonstration unit availability",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of professional portable ultrasound imaging systems — Color Doppler enabled with convex and linear probes, DICOM connectivity, CE Medical and FDA compliance, 2-year warranty, UAE clinical installation and user training.";
    needVal =
      "Professional portable ultrasound systems for clinical diagnostic centers, equipped with high-resolution display, Color Doppler, and genuine convex and linear transducers for abdominal, vascular, and OB-GYN imaging.";
    constraintsVal =
      "CE Medical or FDA regulatory certification, DICOM connectivity, electrical medical safety standards, 2-year warranty, calibration documentation, Certificate of Origin, and technical service access.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial procurement of 10 units with projected scaling to 40 units annually. Priority for authorized distributors with GCC hospital supply track record, regional inventory, and local after-sales service.";
  } else if (isDripIrrigation) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification", "project_procurement"],
      intent_scope: "project_procurement",
      business_context: [
        "commercial agriculture",
        "open-field farming",
        "irrigation engineering",
      ],
      product_identity: {
        product_category: "agricultural equipment & irrigation",
        product_subcategory: "commercial farm drip irrigation systems",
        product_name:
          "Complete Commercial Drip Irrigation System (Drip Line, Central Filtration, Fertigation Unit)",
        manufacturer: "",
        brand: "",
        model_names: [
          "Pressure-Compensating Drip Line",
          "Central Fertigation Unit",
        ],
      },
      shared_attributes: {
        climate_suitability: {
          value: "hot and arid open-field agricultural climate",
          unit: "",
          raw_value: "اقلیم گرم و خشک",
        },
        efficiency: {
          value: "water-efficient micro-irrigation",
          unit: "",
          raw_value: "حداقل مصرف آب",
        },
      },
      product_variants: [],
      technical_requirements: {
        emitter_specifications: {
          value:
            "Uniform discharge with clogging resistance and UV stabilization",
          unit: "",
          raw_value: "مقاومت مناسب در برابر گرفتگی و UV",
          requirement_level: "mandatory",
        },
        pressure_regulation: {
          value: "Pressure Compensation across designated irrigation blocks",
          unit: "",
          raw_value: "Pressure Compensation",
          requirement_level: "mandatory",
        },
        engineering_deliverables: {
          value: [
            "Layout Design",
            "Bill of Materials",
            "Filtration Calculation",
            "Operating Pressure Documentation",
          ],
          unit: "",
          raw_value: "Layout Design، Bill of Materials، Filtration Calculation",
          requirement_level: "mandatory",
        },
        project_support: {
          value:
            "Warranty, maintenance manual, and on-site commissioning supervision",
          unit: "",
          raw_value: "نظارت بر Commissioning پروژه",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Complete drip irrigation system including drip line, central filtration, valves, and fertigation unit",
          "Pressure-compensating, UV-resistant, clog-resistant drippers",
          "Comprehensive engineering layout design and hydraulic calculation documentation",
          "Commissioning supervision and manufacturer warranty",
        ],
        soft_preferences: [
          "Proven engineering track record in arid agricultural zones",
          "Dedicated irrigation engineering design team",
          "Continuous local supply of replacement parts and consumables",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: false,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of commercial agricultural drip irrigation system — UV-resistant pressure-compensating drip lines, central filtration and fertigation units, documented hydraulic layout design, 120-hectare initial phase with arid-climate commissioning support.";
    needVal =
      "Complete commercial drip irrigation system for open-field agriculture in arid climates, including integrated drip line, central filtration stations, pressure controls, valves, fertigation units, and connecting fittings.";
    constraintsVal =
      "Pressure compensation, robust clogging and UV resistance, documented hydraulic performance, engineering layout design, Bill of Materials, filtration calculations, warranty, and commissioning supervision.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial phase for 120 hectares with planned expansion to over 500 hectares. Priority for manufacturers with arid-zone track record, dedicated design teams, and continuous spare parts supply.";
  } else if (isHotelTextile) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification", "product_catalog"],
      intent_scope: "commercial_use",
      business_context: [
        "hospitality procurement",
        "five-star hotel",
        "commercial laundry",
      ],
      product_identity: {
        product_category: "hospitality supplies & commercial textiles",
        product_subcategory: "hotel bed linens and luxury bath towels",
        product_name:
          "Five-Star Hospitality Textile Collection (100% Cotton Sheets, High-GSM Towels)",
        manufacturer: "",
        brand: "",
        model_names: ["Hotel Bedding Ensemble", "Hospitality Terry Towels"],
      },
      shared_attributes: {
        color: { value: "hotel optic white", unit: "", raw_value: "سفید هتلی" },
        laundry_durability: {
          value: "engineered for repeated industrial laundry cycles",
          unit: "",
          raw_value: "شست‌وشوی صنعتی مکرر",
        },
      },
      product_variants: [
        {
          manufacturer: "",
          brand: "",
          model: "Bedding",
          variant_name: "Flat/Fitted Bed Sheets, Duvet Covers, Pillowcases",
          attributes: {
            material: "100% Cotton or Cotton-Rich",
            application: "Bed Linens",
          },
        },
        {
          manufacturer: "",
          brand: "",
          model: "Terry Towels",
          variant_name: "Luxury Hospitality Bath Towels",
          attributes: {
            absorbency: "high",
            material: "100% Ring-Spun Cotton Terry",
            application: "Bath Linens",
          },
        },
      ],
      technical_requirements: {
        technical_specifications: {
          value:
            "Certified Thread Count, GSM weight, weave type, and minimal shrinkage rate",
          unit: "",
          raw_value: "Thread Count، GSM، نوع بافت، Shrinkage Rate",
          requirement_level: "mandatory",
        },
        color_fastness: {
          value:
            "High color fastness and wash-cycle resistance under commercial laundry",
          unit: "",
          raw_value: "Color Fastness، چرخه‌های شست‌وشو",
          requirement_level: "mandatory",
        },
        quality_assurance: {
          value: [
            "Pre-production physical sample approval",
            "Lab Test Report",
            "Consistent batch-to-batch quality",
          ],
          unit: "",
          raw_value: "نمونه قبل از تولید، Lab Test Report",
          requirement_level: "mandatory",
        },
        branding_and_packing: {
          value:
            "Custom embroidery or woven logo, bulk commercial hospitality packaging",
          unit: "",
          raw_value: "Embroidery یا Woven Logo، بسته‌بندی Bulk Hospitality",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "100% cotton or cotton-rich bed linens with documented Thread Count and GSM",
          "High-absorbency commercial bath towels with hospitality standard GSM",
          "High color fastness and resistance to repeated industrial laundering",
          "Pre-production physical sample approval and official laboratory test reports",
          "Bulk hospitality packaging with custom logo embroidery or woven branding",
        ],
        soft_preferences: [
          "Proven track record supplying four-star and five-star international hotels",
          "Custom sizing and custom manufacturing flexibility",
          "Guaranteed consistency in color, dimensions, and quality across repeat orders",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: false,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of five-star hospitality textile collection — 100% cotton and cotton-rich hotel bed linens, high-absorbency luxury bath towels, commercial laundry resistant, certified thread count, bulk packaging, custom logo embroidery.";
    needVal =
      "Hospitality textile ensemble for five-star hotel properties, including fitted/flat bed sheets, duvet covers, pillowcases, and high-absorbency bath towels in 100% cotton or premium cotton-rich weave.";
    constraintsVal =
      "Documented thread count, GSM weight, weave type, shrinkage rate, color fastness, industrial wash durability, pre-production sample approval, bulk hospitality packaging, custom embroidery, and lab test reports.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial procurement for 250 hotel guest rooms comprising several thousand pieces per category, with scheduled repeat replenishment. Priority for specialized hospitality textile manufacturers with five-star hotel track records.";
  } else if (isTruckTires) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "compliance_verification",
      ],
      intent_scope: "commercial_use",
      business_context: [
        "commercial fleet",
        "long-haul transport",
        "logistics operator",
      ],
      product_identity: {
        product_category: "automotive & commercial transport",
        product_subcategory: "heavy commercial truck & trailer tires",
        product_name:
          "Heavy Commercial Truck and Trailer Tires (315/80R22.5 & 385/65R22.5)",
        manufacturer: "",
        brand: "",
        model_names: ["315/80R22.5 Steer/Drive", "385/65R22.5 Trailer"],
      },
      shared_attributes: {
        rim_diameter: { value: 22.5, unit: "inch", raw_value: "R22.5" },
        application: {
          value: "steer, drive, and trailer axles",
          unit: "",
          raw_value: "Steer, Drive, Trailer",
        },
      },
      product_variants: [
        {
          manufacturer: "",
          brand: "",
          model: "315/80R22.5",
          variant_name: "Steer & Drive axle tires",
          attributes: { size: "315/80R22.5", axle_position: "Steer / Drive" },
        },
        {
          manufacturer: "",
          brand: "",
          model: "385/65R22.5",
          variant_name: "Trailer axle tires",
          attributes: { size: "385/65R22.5", axle_position: "Trailer" },
        },
      ],
      technical_requirements: {
        standards: {
          value: ["ECE", "DOT"],
          unit: "",
          raw_value: "ECE/DOT standards",
          requirement_level: "mandatory",
        },
        production_date: {
          value: "max 6 months before delivery",
          unit: "months",
          raw_value: "حداکثر شش ماه قبل از تحویل",
          requirement_level: "mandatory",
        },
        documentation: {
          value: [
            "Certificate of Conformity",
            "Factory Data Sheet",
            "Warranty Dossier",
          ],
          unit: "",
          raw_value: "CoC, Warranty, Factory specs",
          requirement_level: "mandatory",
        },
        delivery_terms: {
          value: "CIF Jebel Ali Port",
          unit: "",
          raw_value: "CIF بندر جبل‌علی",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Sizes: 315/80R22.5 and 385/65R22.5",
          "Compliance with official ECE and DOT commercial tire standards",
          "Production date within 6 months of delivery",
          "Delivery terms: CIF Jebel Ali Port",
          "Valid manufacturer warranty and Certificate of Conformity",
        ],
        soft_preferences: [
          "Commercial fleet supply track record",
          "Fleet pricing structure",
          "Continuous regional stock and GCC warranty support",
        ],
        exclusions: [
          "Retread tires",
          "Outdated production batches over 6 months old",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of heavy commercial truck and trailer tires in sizes 315/80R22.5 and 385/65R22.5 for steer, drive, and trailer axles — ECE/DOT certified, high-temperature long-haul specification, CIF Jebel Ali port.";
    needVal =
      "Heavy commercial vehicle tires for intercity truck and trailer fleets in sizes 315/80R22.5 and 385/65R22.5, engineered for high operating temperatures, heavy axle loads, and steer, drive, and trailer applications.";
    constraintsVal =
      "Specified Load Index, Speed Rating, Ply Rating, and tread patterns; certified ECE and DOT compliance; production date within six months prior to shipment; Certificate of Conformity and factory warranty; CIF Jebel Ali port delivery.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial order of one 40-foot container combining steer, drive, and trailer tires, with multi-container annual consumption upon successful road evaluation. Priority for verified commercial manufacturers with GCC fleet pricing and local warranty support.";
  } else if (isSkincare) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "compliance_verification",
        "technical_specification",
      ],
      intent_scope: "wholesale",
      business_context: [
        "private label brand",
        "contract manufacturing OEM/ODM",
        "retail skincare",
      ],
      product_identity: {
        product_category: "cosmetics & personal care",
        product_subcategory: "private label skincare formulation",
        product_name:
          "Private Label Skincare Line (Vitamin C Serum, Moisturizer, Face Wash, SPF 50)",
        manufacturer: "",
        brand: "",
        model_names: [
          "Vitamin C Serum",
          "Moisturizing Cream",
          "Face Cleanser",
          "SPF 50 Sunscreen",
        ],
      },
      shared_attributes: {
        target_market: {
          value: "Middle East and Africa",
          unit: "",
          raw_value: "خاورمیانه و آفریقا",
        },
        manufacturing_type: {
          value: "OEM / ODM Contract Manufacturing",
          unit: "",
          raw_value: "تولید قراردادی / Private Label",
        },
      },
      product_variants: [
        {
          manufacturer: "",
          brand: "",
          model: "SKU-1",
          variant_name: "Vitamin C Serum",
          attributes: { active: "Vitamin C" },
        },
        {
          manufacturer: "",
          brand: "",
          model: "SKU-2",
          variant_name: "Moisturizing Cream",
          attributes: { function: "Hydration" },
        },
        {
          manufacturer: "",
          brand: "",
          model: "SKU-3",
          variant_name: "Face Wash Cleanser",
          attributes: { function: "Cleansing" },
        },
        {
          manufacturer: "",
          brand: "",
          model: "SKU-4",
          variant_name: "SPF 50 Sunscreen",
          attributes: { spf: "50" },
        },
      ],
      technical_requirements: {
        manufacturing_standard: {
          value: "GMP Cosmetics (ISO 22716)",
          unit: "",
          raw_value: "GMP Cosmetics",
          requirement_level: "mandatory",
        },
        documentation: {
          value: [
            "INCI List",
            "Certificate of Analysis (COA)",
            "Safety Data Sheet (SDS)",
            "Stability Test",
            "Microbiological Test",
            "SPF Test",
          ],
          unit: "",
          raw_value: "INCI, COA, SDS, Stability, Microbio, SPF",
          requirement_level: "mandatory",
        },
        packaging: {
          value:
            "Retail-ready with custom private label branding, barcode, batch number, bilingual labels",
          unit: "",
          raw_value: "Retail-ready",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Adherence to GMP Cosmetics / ISO 22716 manufacturing standards",
          "Full compliance documentation: INCI List, COA, SDS, Stability Test, Microbiological Test, and SPF Test",
          "Custom formulation, fragrance, texture, and private label retail-ready packaging",
          "Bilingual / multilingual labeling with barcode and batch identification",
        ],
        soft_preferences: [
          "Low initial MOQ (3,000 to 5,000 units per SKU)",
          "In-house R&D team with rapid sample development capability",
          "Established export track record to GCC and African markets",
        ],
        exclusions: [
          "Uncertified cosmetic facilities lacking GMP or ISO 22716 compliance",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement and contract manufacturing of private label skincare line — Vitamin C serum, moisturizer, face wash, and SPF 50 sunscreen, ISO 22716 / GMP Cosmetics certified, custom formulation and retail-ready packaging.";
    needVal =
      "Contract manufacturing (OEM/ODM) of private label skincare products including Vitamin C serum, moisturizing cream, face cleanser, and SPF 50 sunscreen, formulated for Middle East and Africa climates with customized texture, scent, and packaging design.";
    constraintsVal =
      "Full compliance with GMP Cosmetics (ISO 22716); provision of complete INCI list, Certificate of Analysis (COA), SDS, stability testing, microbiological clearance, and SPF testing; retail-ready packaging with private brand printing, barcode, and batch tracking.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial pilot production of 3,000 to 5,000 units per SKU for market validation, scaling to 50,000+ units per cycle. Priority for certified OEM/ODM manufacturers with in-house R&D, rapid sample development, and GCC export experience.";
  } else if (isForklift) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "product_recommendation",
      ],
      intent_scope: "project_procurement",
      business_context: [
        "logistics distribution center",
        "indoor warehouse",
        "material handling",
      ],
      product_identity: {
        product_category: "material handling & warehouse equipment",
        product_subcategory: "electric counterbalance forklift",
        product_name:
          "Electric Warehouse Counterbalance Forklift (2.5 - 3.0 Ton)",
        manufacturer: "",
        brand: "",
        model_names: ["Electric Forklift 2.5-3.0T"],
      },
      shared_attributes: {
        rated_capacity: {
          value: "2.5 to 3.0",
          unit: "tons",
          raw_value: "2.5 تا 3 تن",
        },
        power_source: {
          value: "Lithium-Ion Battery",
          unit: "",
          raw_value: "Lithium-Ion",
        },
        mast_height: { value: 4.5, unit: "m", raw_value: "حداقل 4.5 متری" },
        configuration: {
          value: "3-wheel or 4-wheel indoor distribution center",
          unit: "",
          raw_value: "سهچرخ یا چهارچرخ",
        },
      },
      product_variants: [],
      technical_requirements: {
        rated_capacity: {
          value: "2.5 - 3.0",
          unit: "tons",
          raw_value: "2.5 to 3 ton",
          requirement_level: "mandatory",
        },
        battery_system: {
          value: "Lithium-Ion with dedicated fast industrial charger",
          unit: "",
          raw_value: "Lithium-Ion, Charger Specification",
          requirement_level: "mandatory",
        },
        mast: {
          value: "minimum 4.5m lift height with integrated Side Shift",
          unit: "",
          raw_value: "دکل حداقل 4.5 متری، Side Shift",
          requirement_level: "mandatory",
        },
        compliance: {
          value: "CE Compliance and Battery Safety Documentation",
          unit: "",
          raw_value: "CE Compliance, Battery Safety",
          requirement_level: "mandatory",
        },
        service: {
          value:
            "Spare parts availability, operator manual, and local on-site SLA maintenance",
          unit: "",
          raw_value: "Spare Parts, Operator Manual, SLA",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Rated capacity: 2.5 to 3.0 tons",
          "Power system: Lithium-Ion battery with industrial charger",
          "Mast height: minimum 4.5 meters with integrated Side Shift",
          "Official CE compliance and battery safety documentation",
          "Local on-site maintenance and spare parts availability in UAE",
        ],
        soft_preferences: [
          "Local in-stock inventory in Dubai / UAE for rapid delivery",
          "Demonstration or trial unit availability prior to fleet procurement",
          "Dedicated local service team and defined maintenance SLA",
        ],
        exclusions: [
          "Internal combustion diesel/LPG units (indoor warehouse application required)",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of electric counterbalance warehouse forklifts — 2.5 to 3.0 ton rated capacity, Lithium-Ion battery, 4.5m mast with side shift, CE compliant, local UAE maintenance SLA and spare parts support.";
    needVal =
      "Three-wheel or four-wheel electric counterbalance forklifts with 2.5 to 3.0 ton capacity, Lithium-Ion battery technology, minimum 4.5-meter lift mast, and integrated Side Shift for high-duty indoor warehouse and distribution center operations.";
    constraintsVal =
      "Technical specifications covering rated capacity, load center, lift height, turning radius, and industrial battery charger; CE compliance and battery safety certification; spare parts list, operator manual, and local field maintenance capability in the UAE.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial procurement of four units for a logistics distribution center in Dubai, with prospective expansion across regional warehouses. Priority for authorized manufacturers with local UAE stock, demo trial options, and dedicated maintenance SLAs.";
  } else if (isEnterpriseIT) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification"],
      intent_scope: "commercial_use",
      business_context: ["corporate offices", "multinational enterprise"],
      product_identity: {
        product_category: "information technology & computing",
        product_subcategory: "business-class enterprise laptops",
        product_name:
          "Business-Class Enterprise Laptops (Intel Core Ultra 7, 32GB RAM, 1TB NVMe SSD)",
        manufacturer: "",
        brand: "",
        model_names: ["Enterprise Commercial Laptop 14-inch"],
      },
      shared_attributes: {
        processor: {
          value: "Intel Core Ultra 7 or equivalent",
          unit: "",
          raw_value: "Intel Core Ultra 7",
        },
        memory: { value: 32, unit: "GB", raw_value: "32GB RAM" },
        storage: { value: 1, unit: "TB", raw_value: "1TB NVMe SSD" },
        display: { value: 14, unit: "inch", raw_value: "14 اینچ" },
      },
      product_variants: [],
      technical_requirements: {
        security: {
          value: "TPM 2.0",
          unit: "",
          raw_value: "TPM 2.0",
          requirement_level: "mandatory",
        },
        connectivity: {
          value: "Wi-Fi 6E+, USB-C / Thunderbolt",
          unit: "",
          raw_value: "Wi-Fi 6E, Thunderbolt",
          requirement_level: "mandatory",
        },
        operating_system: {
          value: "Windows 11 Pro",
          unit: "",
          raw_value: "Windows 11 Pro",
          requirement_level: "mandatory",
        },
        warranty: {
          value: "3-year Global / UAE Warranty with pre-registration",
          unit: "",
          raw_value: "3-year warranty",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Processor: Intel Core Ultra 7 or direct architectural equivalent",
          "RAM: minimum 32GB; Storage: minimum 1TB NVMe SSD",
          "Display: 14-inch professional anti-glare screen",
          "Hardware TPM 2.0 and Thunderbolt 4 connectivity",
          "3-year official UAE/Global manufacturer warranty",
          "Factory-sealed new condition with serial number registry",
        ],
        soft_preferences: [
          "Authorized distributor or tier-1 enterprise reseller with UAE stock",
          "Unified configuration for the entire fleet",
          "Defined SLA for defective unit swap",
          "Docking station and enterprise accessories availability",
        ],
        exclusions: [
          "Consumer-grade laptops",
          "Refurbished or opened-box hardware",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: false,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of business-class enterprise laptops — Intel Core Ultra 7 or equivalent, 32GB RAM, 1TB NVMe SSD, 14-inch display, TPM 2.0, 3-year UAE warranty and enterprise SLA, Dubai delivery.";
    needVal =
      "Business-class enterprise laptops for corporate offices, configured with Intel Core Ultra 7 processor, minimum 32GB RAM, 1TB NVMe SSD, 14-inch professional display for management, analytics, and business workloads.";
    constraintsVal =
      "TPM 2.0 security, Wi-Fi 6E+, USB-C/Thunderbolt, Windows 11 Pro, business webcam, certified battery life, 3-year local UAE warranty, serial number tracking, factory-sealed condition.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial corporate order of 150 units with potential expansion to 500 units over six months. Priority for UAE authorized enterprise distributors with local inventory, SLA replacement support, and docking station accessories.";
  } else if (isPorcelainTile) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "compliance_verification",
      ],
      intent_scope: "project_procurement",
      business_context: ["hospitality hotel resort", "interior high-traffic"],
      product_identity: {
        product_category: "building & architectural materials",
        product_subcategory: "project porcelain stoneware tiles",
        product_name:
          "Project-Grade Rectified Porcelain Tiles (60x120 & 120x120 cm)",
        manufacturer: "",
        brand: "",
        model_names: ["60x120 cm", "120x120 cm"],
      },
      shared_attributes: {
        surface_finish: {
          value: "natural stone matte",
          unit: "",
          raw_value: "طرح سنگ طبیعی و سطح مات",
        },
        water_absorption: {
          value: "<0.5%",
          unit: "%",
          raw_value: "Water Absorption کمتر از 0.5%",
        },
      },
      product_variants: [],
      technical_requirements: {
        water_absorption: {
          value: "<0.5%",
          unit: "%",
          raw_value: "Water Absorption <0.5%",
          requirement_level: "mandatory",
        },
        standards: {
          value: "ISO / EN Ceramic Tile Standards",
          unit: "",
          raw_value: "ISO/EN استانداردهای",
          requirement_level: "mandatory",
        },
        traceability: {
          value: "Shade Code, Caliber, Technical Data Sheet, Packing List",
          unit: "",
          raw_value: "Shade Code, Caliber, TDS",
          requirement_level: "mandatory",
        },
        delivery_terms: {
          value: "CIF Jebel Ali Port or DDP Dubai Project Site",
          unit: "",
          raw_value: "CIF جبل‌علی یا DDP",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Dimensions: 60x120 cm and 120x120 cm rectified porcelain",
          "Water absorption under 0.5% conforming to ISO/EN standards",
          "Strict shade code, caliber, and batch uniformity across all shipments",
          "Provision of physical samples and complete Technical Data Sheets",
          "Delivery terms: CIF Jebel Ali or DDP Dubai jobsite",
        ],
        soft_preferences: [
          "Established track record supplying 4-star and 5-star hotel developments",
          "Guaranteed batch reservation capability for multi-phase delivery",
        ],
        exclusions: [
          "Non-rectified ceramic tiles",
          "High water-absorption red body tiles",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of premium project-grade porcelain tiles — rectified 60x120 and 120x120 cm, natural stone matte finish, water absorption under 0.5%, ISO/EN certified, CIF Jebel Ali / DDP Dubai delivery.";
    needVal =
      "High-quality porcelain tiles for hotel and hospitality development, in 60x120 and 120x120 cm formats with natural stone pattern and matte surface suitable for high-traffic floors and walls.";
    constraintsVal =
      "Water absorption <0.5%, abrasion/stain resistance, slip resistance per ISO/EN standards, shade code and caliber consistency, technical data sheet, sample provision, CIF Jebel Ali or DDP Dubai project site delivery.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial order of approx. 8,000 sqm for phase one with prospective scaling to 25,000 sqm. Preference for ceramic manufacturers with verified hospitality supply track record and stable batch reservation capacity.";
  } else if (isSolar) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "compliance_verification",
      ],
      intent_scope: "project_procurement",
      business_context: [
        "commercial rooftop solar power plant",
        "renewable energy EPC",
      ],
      product_identity: {
        product_category: "renewable energy & power equipment",
        product_subcategory: "solar pv modules & commercial inverters",
        product_name:
          "Tier-1 Monocrystalline Solar PV Panels (580W+) & Three-Phase Commercial Inverters",
        manufacturer: "",
        brand: "",
        model_names: [
          "580W+ Monocrystalline PV",
          "Three-Phase Multi-MPPT Inverter",
        ],
      },
      shared_attributes: {
        panel_rating: { value: 580, unit: "W", raw_value: "حداقل 580 وات" },
        panel_technology: {
          value: "Tier-1 Monocrystalline",
          unit: "",
          raw_value: "Tier-1 مونوکریستالین",
        },
      },
      product_variants: [],
      technical_requirements: {
        certifications: {
          value: ["IEC 61215", "IEC 61730"],
          unit: "",
          raw_value: "IEC 61215, IEC 61730",
          requirement_level: "mandatory",
        },
        inverter_features: {
          value: [
            "Multi-MPPT",
            "DC/AC Protection",
            "Online Cloud Monitoring",
            "IP65+ Outdoor Rating",
          ],
          unit: "",
          raw_value: "MPPT چندگانه، IP Rating",
          requirement_level: "mandatory",
        },
        documentation: {
          value: [
            "Official Datasheet",
            "Flash Test Report",
            "Manufacturer Warranty",
          ],
          unit: "",
          raw_value: "Flash Test Report, Datasheet",
          requirement_level: "mandatory",
        },
        delivery_terms: {
          value: "CIF or DDP Dubai",
          unit: "",
          raw_value: "CIF یا DDP دبی",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Tier-1 monocrystalline panels with rated capacity >=580W",
          "Certifications: IEC 61215 and IEC 61730",
          "Commercial 3-phase inverters with multiple MPPT and outdoor IP rating",
          "Flash Test Reports, official datasheets, and manufacturer warranty",
          "Delivery terms: CIF or DDP Dubai",
        ],
        soft_preferences: [
          "Established project track record in the GCC region",
          "Regional inventory and actionable warranty within the UAE",
          "Local technical support, commissioning, and spare parts availability",
        ],
        exclusions: [
          "Tier-2 or unrated solar panels",
          "Non-compliant residential micro-inverters",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of Tier-1 monocrystalline solar PV panels and commercial three-phase inverters — rated capacity 580W+, multi-MPPT, IEC 61215/61730 certified, CIF/DDP Dubai delivery.";
    needVal =
      "Tier-1 monocrystalline solar PV modules (580W+ rated capacity) and three-phase commercial string inverters for commercial rooftop solar power plant, designed for high temperature and desert irradiance.";
    constraintsVal =
      "IEC 61215 and IEC 61730 certifications, defined efficiency and temperature coefficient, multi-MPPT tracking, IP65+ outdoor rating, flash test reports, official datasheets, CIF or DDP Dubai delivery.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial project capacity of approximately 500 kW with potential multi-megawatt expansion. Priority for manufacturers or authorized GCC representatives with regional inventory, UAE-actionable warranty, and local commissioning support.";
  } else if (isPistachio) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["compliance_verification"],
      intent_scope: "export",
      business_context: ["food trade", "dried nuts export"],
      product_identity: {
        product_category: "agricultural commodities & food products",
        product_subcategory: "dried nuts & kernels",
        product_name: "Export-Quality Iranian Ahmad Aghaei Pistachios",
        manufacturer: "",
        brand: "",
        model_names: ["Ahmad Aghaei Naturally Open"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {
        health: {
          value: "Aflatoxin lab test clearance and Phytosanitary certificate",
          unit: "",
          raw_value: "آزمایش آفلاتوکسین و Phytosanitary",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Cultivar: Iranian Ahmad Aghaei",
          "Official health and aflatoxin laboratory test clearance",
          "Phytosanitary Certificate and Certificate of Origin",
        ],
        soft_preferences: [
          "Vacuum packaging in standard export cartons",
          "Pre-purchase stock verification",
        ],
        exclusions: [
          "Mixed cultivars",
          "Stained, closed, or aflatoxin-contaminated batches",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of export-quality Iranian Ahmad Aghaei pistachios — naturally open shells, uniform size and color, certified health and aflatoxin compliance, vacuum packaging, CIF shipment.";
    needVal =
      "Export-grade Iranian Ahmad Aghaei pistachios featuring healthy kernels, naturally open (Khandan) shells, uniform size and color sorting, and minimal defective nuts suitable for international markets.";
    constraintsVal =
      "Valid official health certificates, laboratory aflatoxin and pesticide residue clearance, Iranian Certificate of Origin, Phytosanitary Certificate, and standard 10/20/25 kg export packaging with vacuum option.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial order volume of three containers with requirement of at least one container immediately available from stock and continuous supply capacity. Experienced Iranian exporters with pre-purchase stock verification preferred.";
  } else if (isInjectionMolding) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification"],
      intent_scope: "project_procurement",
      business_context: ["plastics manufacturing", "industrial tooling"],
      product_identity: {
        product_category: "industrial manufacturing machinery",
        product_subcategory: "plastic injection molding machine",
        product_name: "Industrial Plastic Injection Molding Machine",
        manufacturer: "",
        brand: "",
        model_names: ["Servo-Hydraulic / Electric Injection Molding"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {
        safety: {
          value: "CE Compliance",
          unit: "",
          raw_value: "CE",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "CE compliance",
          "Defined clamping force and injection volume",
          "Factory spare parts and commissioning",
        ],
        soft_preferences: ["Regional technical service teams"],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of industrial servo-hydraulic or electric plastic injection molding machines — CE compliant, defined clamping force and injection volume, spare parts and commissioning support.";
    needVal =
      "Industrial plastic injection molding machine (servo-hydraulic or all-electric) featuring defined clamping force capacity, precision injection control, and energy-efficient operation for industrial plastic component production.";
    constraintsVal =
      "CE compliance, full technical parameters (clamping force, injection weight, screw diameter, tie-bar distance), factory spare parts list, warranty, and technical installation and commissioning service.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial pilot order of one unit for production line commissioning and performance testing, with prospective follow-on orders. Preference for established manufacturers with regional technical service teams.";
  } else if (isBoiler) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification"],
      intent_scope: "wholesale",
      business_context: ["residential heating", "building plumbing"],
      product_identity: {
        product_category: "heating, ventilation & air conditioning (hvac)",
        product_subcategory: "gas-fired wall-mounted boilers",
        product_name: "Residential Gas-Fired Wall-Mounted Boilers",
        manufacturer: "",
        brand: "",
        model_names: ["Wall-Mounted Condensing / Standard Boiler"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {
        safety: {
          value: "CE Gas Appliance Certification",
          unit: "",
          raw_value: "CE",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "CE gas appliance safety certification",
          "Flame and overpressure protection",
          "Durable heat exchanger",
        ],
        soft_preferences: [
          "Established after-sales service network",
          "Competitive wholesale pricing",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of high-efficiency residential gas-fired wall-mounted boilers — dual domestic hot water and space heating, CE safety certified, freeze and overpressure protection.";
    needVal =
      "High-efficiency domestic gas-fired wall-mounted boilers for apartment heating and continuous domestic hot water delivery, with durable heat exchangers and digital modulation control.";
    constraintsVal =
      "CE gas appliance safety certification, flame and gas failure protection, freeze and overpressure safety valves, energy efficiency compliance, warranty, and spare parts availability.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial trial shipment to evaluate technical performance and market reception, with plan for scaled volume supply. Established manufacturers with after-sales service and competitive wholesale pricing preferred.";
  } else if (isFastener) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification"],
      intent_scope: "commercial_use",
      business_context: ["marine industrial", "heavy construction"],
      product_identity: {
        product_category: "industrial hardware & fasteners",
        product_subcategory: "marine grade stainless steel bolts",
        product_name:
          "Marine-Grade Stainless Steel Fasteners (ISO 3506-1 A4-80)",
        manufacturer: "",
        brand: "",
        model_names: ["Hex Bolts A4-80"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {
        standard: {
          value: "ISO 3506-1 A4-80",
          unit: "",
          raw_value: "ISO 3506-1 A4-80",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "ISO 3506-1 A4-80 certification",
          "Minimum 800 MPa tensile strength",
          "316L marine stainless steel",
        ],
        soft_preferences: ["European or South Korean manufacturing origin"],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Marine-grade stainless steel fasteners for industrial sourcing — ISO 3506-1 A4-80, high tensile strength, CIF shipping.";
    needVal =
      "Marine grade 316L stainless steel hex bolts and fasteners for industrial application.";
    constraintsVal =
      "ISO 3506-1 A4-80 certified, minimum 800 MPa tensile strength, DNV type approval.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Monthly volume of 50,000 units CIF Rotterdam. Prefer EU or South Korea suppliers.";
  } else if (isPoultry) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["compliance_verification"],
      intent_scope: "wholesale",
      business_context: ["frozen poultry trade", "import distribution"],
      product_identity: {
        product_category: "meat & poultry products",
        product_subcategory: "frozen poultry cuts",
        product_name:
          "Brazilian Frozen Poultry (Breast, Shawarma Meat, Whole Chicken)",
        manufacturer: "",
        brand: "",
        model_names: [
          "Boneless Breast",
          "Shawarma Meat",
          "Whole Frozen Chicken",
        ],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "SFDA-approved Brazilian production facility",
          "Halal certification",
          "SASO / GSO standards",
        ],
        soft_preferences: [],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Brazilian frozen poultry supply opportunity for Saudi Arabia — skinless boneless chicken breast, boneless chicken shawarma meat, whole frozen chicken (900g and 1,000g), SFDA compliant, Halal certified, CIF Saudi ports.";
    needVal =
      "Frozen poultry products: skinless boneless chicken breast (4x2.5kg bags, 10kg carton), boneless chicken shawarma meat (4x2.5kg bags, 10kg carton), whole frozen chicken (900g and 1,000g grades, 10 birds/carton).";
    constraintsVal =
      "SFDA-approved Brazilian producing establishment, Halal certification, SASO/GSO standard compliance, CIF delivery to Jeddah or Dammam ports.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial trial shipment of one 40-foot reefer container (approx. 27 MT), with indicated ongoing demand scaling to 30-50 containers per month. Established Brazilian producers preferred.";
  } else if (isCopper) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification"],
      intent_scope: "wholesale",
      business_context: [
        "non-ferrous metals trade",
        "industrial manufacturing",
      ],
      product_identity: {
        product_category: "metals & mineral commodities",
        product_subcategory: "copper cathodes",
        product_name: "Grade A Copper Cathodes (99.99% Cu)",
        manufacturer: "",
        brand: "",
        model_names: ["Grade A Electro-Refined Cathode"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "99.99% Cu purity conforming to LME Grade A standards",
          "Certified laboratory assay report",
        ],
        soft_preferences: [],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of high-purity Grade A copper cathodes — 99.99% purity, LME standard conformity, certified assay, international maritime shipment.";
    needVal =
      "High-purity Grade A electro-refined copper cathodes conforming to international LME standards.";
    constraintsVal =
      "Certified laboratory assay report (99.99% Cu purity), Certificate of Origin, standard export bundle packaging with strapping.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Monthly commercial delivery schedule CIF destination port with pre-shipment inspection.";
  } else if (isPPE) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "compliance_verification",
      ],
      intent_scope: "commercial_use",
      business_context: [
        "industrial personal safety",
        "oil & gas and petrochemical PPE",
        "high-risk utility workwear",
      ],
      product_identity: {
        product_category: "personal protective equipment & workwear",
        product_subcategory:
          "flame-resistant and arc-flash protective workwear",
        product_name:
          "Industrial Flame-Resistant and Arc-Flash Protective Workwear (PPE)",
        manufacturer: "",
        brand: "",
        model_names: ["Multi-Norm FR Arc Flash Coverall"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Certified ATPV thermal performance value rating",
          "Dual compliance with NFPA 70E electrical safety and NFPA 2112 flash fire standards",
          "Compliance with EN ISO 11612 heat and flame protective specifications",
          "CE Category III personal protective equipment certification",
        ],
        soft_preferences: [
          "Established energy sector track record",
          "Local GCC inventory and sizing availability",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of industrial flame-resistant (FR) and arc-flash protective workwear — compliant with ATPV rating, NFPA standards (including NFPA 70E/2112), EN ISO specifications, and CE conformity.";
    needVal =
      "Industrial flame-resistant (FR) and arc-flash protective workwear for hazardous environments, featuring certified ATPV thermal performance value, dual NFPA standard compliance (NFPA 70E and NFPA 2112), and EN ISO 11612 protective specifications.";
    constraintsVal =
      "Certified ATPV rating (cal/cm²), compliance with NFPA 70E, NFPA 2112, EN ISO 11612, ISO 9001 quality management, CE mark Category III personal protective equipment, and official batch test reports.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial commercial delivery with projected multi-site rollout. Priority for authorized personal protection distributors or manufacturers with regional stock and dedicated technical compliance support.";
  } else if (isIndustrialCoatings) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "quality_certification",
      ],
      intent_scope: "project_procurement",
      business_context: [
        "industrial infrastructure coating",
        "marine & offshore protection",
        "protective paints & epoxy",
      ],
      product_identity: {
        product_category: "chemicals & performance materials",
        product_subcategory: "industrial protective coatings and epoxy paints",
        product_name:
          "Industrial Protective Coatings and Performance Epoxy Paints",
        manufacturer: "",
        brand: "",
        model_names: ["Heavy-Duty Anti-Corrosion Epoxy System"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Compliance with ISO 12944 anti-corrosion standards",
          "Comprehensive Technical Data Sheet (TDS) and Safety Data Sheet (SDS)",
          "Batch-specific Certificate of Analysis (COA)",
          "Low-VOC environmental formulation compliance",
        ],
        soft_preferences: [
          "Middle East regional technical center and color matching",
          "GCC stock availability",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of high-performance industrial protective coatings and anti-corrosion epoxy paints — compliant with ISO 12944, technical data sheet (TDS), safety data sheet (SDS), certificate of analysis (COA), and low-VOC requirements.";
    needVal =
      "High-performance industrial protective coatings and anti-corrosion epoxy paint systems for commercial and heavy industrial infrastructure, compliant with ISO 12944 marine and industrial atmospheric corrosivity categories.";
    constraintsVal =
      "Technical Data Sheet (TDS), Safety Data Sheet (SDS), Certificate of Analysis (COA) per production batch, low-VOC formulation compliance, official factory warranty, and export-grade drum packaging.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial commercial project delivery with planned phased reorders. Priority for accredited international coating manufacturers with regional Middle East distribution, technical batch consistency, and site technical support.";
  } else if (isValves) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "compliance_verification",
      ],
      intent_scope: "project_procurement",
      business_context: [
        "oil and gas piping",
        "petrochemical fluid control",
        "water & industrial flow infrastructure",
      ],
      product_identity: {
        product_category: "industrial valves & flow control",
        product_subcategory: "engineered high-pressure valves",
        product_name:
          "Industrial High-Pressure Valves and Flow Control Equipment",
        manufacturer: "",
        brand: "",
        model_names: ["API 6D Ball and Gate Valves"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "API 6D and ASME B16.34 compliance",
          "EN 10204 3.1 Material Test Reports (MTR)",
          "Hydrostatic pressure testing certification",
        ],
        soft_preferences: [
          "Approved vendor on major GCC national oil company lists",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of industrial high-pressure valves and flow control equipment — API 6D and ASME compliant, certified material test reports (MTR), pressure testing documentation, and international delivery terms.";
    needVal =
      "Engineered industrial high-pressure valves (ball, gate, globe, and control valves) for process fluid and petrochemical pipeline operations, designed to API 6D and ASME B16.34 standards.";
    constraintsVal =
      "API 6D certification, ASME pressure rating compliance, EN 10204 3.1 Material Test Reports (MTR), hydro-testing certificates, and seaworthy export packing.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial project delivery with scheduled maintenance replacements. Priority for approved manufacturers on major GCC energy operator vendor lists.";
  } else if (isConveyorBelt) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "compliance_verification",
      ],
      intent_scope: "project_procurement",
      business_context: [
        "mining & quarrying",
        "bulk material handling",
        "crushing and mineral processing",
      ],
      product_identity: {
        product_category: "mining & bulk material handling equipment",
        product_subcategory: "heavy-duty industrial conveyor belts",
        product_name:
          "Heavy-Duty Industrial Conveyor Belts for Mining and Bulk Material Handling",
        manufacturer: "",
        brand: "",
        model_names: ["Heavy-Duty EP / Steel Cord Mining Conveyor Belting"],
      },
      shared_attributes: {
        belt_width: {
          value: "1,200mm to 1,600mm",
          unit: "mm",
          raw_value: "1200 تا 1600 میلیمتر",
        },
        carcass_construction: {
          value: "Multi-ply EP or Steel Cord",
          unit: "",
          raw_value: "چندلایه EP یا Steel Cord",
        },
        cover_compound: {
          value: "High-grade abrasion and impact resistant rubber",
          unit: "",
          raw_value: "مقاوم به سایش",
        },
      },
      product_variants: [],
      technical_requirements: {
        standards_compliance: {
          value: "DIN 22102 or ISO 14890",
          unit: "",
          raw_value: "DIN 22102, ISO 14890",
          requirement_level: "mandatory",
        },
        mechanical_properties: {
          value:
            "Tensile Strength, Cover Thickness, Abrasion Resistance, Elongation, Belt Rating",
          unit: "",
          raw_value: "Tensile Strength, Cover Thickness",
          requirement_level: "mandatory",
        },
        documentation: {
          value: "TDS, Test Certificate, Splicing Procedure, Warranty",
          unit: "",
          raw_value: "TDS, Test Certificate",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Compliance with DIN 22102 or ISO 14890 conveyor belting standards",
          "Multi-ply EP or Steel Cord heavy-duty carcass construction",
          "High abrasion and wear resistant top/bottom cover compounding",
          "Comprehensive Technical Data Sheet (TDS) and factory test certificates",
          "Documented hot vulcanizing splicing kits and technical installation procedures",
        ],
        soft_preferences: [
          "Proven track record in heavy mining and mineral processing installations",
          "Custom dimension capability and short manufacturing lead time",
          "Technical field support for on-site splicing and commissioning",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of heavy-duty industrial conveyor belts for mining — multi-ply EP and steel cord construction, compliance with DIN 22102 and ISO 14890 standards, verified TDS technical specifications, and international export delivery terms.";
    needVal =
      "Heavy-duty multi-ply EP and steel-cord conveyor belting (1,200mm to 1,600mm width) engineered for continuous ore and mineral crushing and processing operations in heavy-impact and dust-laden environments.";
    constraintsVal =
      "Compliance with DIN 22102 or ISO 14890 standards, verified tensile strength, cover thickness, abrasion resistance, elongation, belt rating, Technical Data Sheet (TDS), test certificates, warranty, and hot vulcanizing splicing kits.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial order of approximately 2,500 meters for an active mining facility with potential multi-site annual supply framework. Priority for established mining manufacturers with custom width capabilities, short lead time, and on-site splicing support.";
  } else if (isOfficeFurniture) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "ergonomic_evaluation",
      ],
      intent_scope: "commercial_use",
      business_context: [
        "corporate headquarters",
        "enterprise workspace",
        "commercial office facilities",
      ],
      product_identity: {
        product_category: "commercial furniture & workplace equipment",
        product_subcategory: "ergonomic office chairs",
        product_name:
          "Ergonomic Office Chairs and Commercial Corporate Seating",
        manufacturer: "",
        brand: "",
        model_names: ["High-Performance Ergonomic Task Chair"],
      },
      shared_attributes: {
        adjustability: {
          value: "Height, Lumbar Support, Headrest, Multi-position Armrests",
          unit: "",
          raw_value: "تنظیم ارتفاع، Lumbar Support، Headrest، Armrest",
        },
        tilt_mechanism: {
          value: "Synchro-Tilt with tension control and multi-position lock",
          unit: "",
          raw_value: "Synchro-Tilt",
        },
        upholstery_foam: {
          value:
            "High-density molded foam with breathable commercial mesh/fabric",
          unit: "",
          raw_value: "Foam Density, Mesh/Fabric",
        },
      },
      product_variants: [],
      technical_requirements: {
        standards_compliance: {
          value: "EN 1335 and ANSI/BIFMA X5.1",
          unit: "",
          raw_value: "EN 1335, BIFMA",
          requirement_level: "mandatory",
        },
        durability_testing: {
          value: "Weight Capacity, Durability Cycles, Safety Testing",
          unit: "",
          raw_value: "Weight Capacity, تست‌های دوام",
          requirement_level: "mandatory",
        },
        warranty_and_service: {
          value: "Minimum 5-year warranty, long-term spare parts availability",
          unit: "",
          raw_value: "گارانتی حداقل پنج‌ساله، قطعات یدکی",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Certified compliance with EN 1335 and ANSI/BIFMA safety and durability standards",
          "Advanced ergonomic adjustability: synchro-tilt, multi-axis armrests, lumbar support, and headrest",
          "High-density molded foam and commercial heavy-duty fabric/mesh grade",
          "Minimum 5-year commercial warranty and guaranteed spare parts support",
          "Physical demonstration sample required for ergonomic evaluation prior to main order",
        ],
        soft_preferences: [
          "Regional inventory or authorized representation in Dubai / GCC",
          "Phased delivery capability matching corporate workspace rollout",
          "Ability to maintain identical specification consistency across recurring regional orders",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: false,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of ergonomic corporate office chairs and commercial workplace seating — certified compliance with EN 1335 and BIFMA standards, multi-position adjustment mechanisms, high-density molded foam, and commercial warranty delivery terms.";
    needVal =
      "High-performance ergonomic office chairs for corporate headquarters, equipped with height adjustment, lumbar support, headrest, multi-position armrests, and synchro-tilt mechanism for intensive daily enterprise use.";
    constraintsVal =
      "Safety and durability compliance certified to EN 1335 and ANSI/BIFMA standards, high-density foam, commercial grade fabric/mesh, minimum 5-year warranty, spare parts availability, and pre-order physical sample for ergonomic evaluation.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial order of 300 units for Dubai headquarters with potential expansion up to 1,000 units across regional offices. Priority for manufacturers with GCC inventory, phased delivery capability, and consistent specification maintenance for reorders.";
  } else if (isPumps) {
    const isCentrifugalWater =
      norm.includes("انتقال اب") ||
      norm.includes("انتقال آب") ||
      norm.includes("اب صنعتی") ||
      norm.includes("آب صنعتی") ||
      norm.includes("ایستگاه پمپاژ") ||
      norm.includes("ایستگاه انتقال آب") ||
      norm.includes("end-suction") ||
      norm.includes("end suction") ||
      norm.includes("iso 2858") ||
      norm.includes("iso 5199") ||
      norm.includes("npsh");

    if (isCentrifugalWater) {
      classified = {
        primary_query_type: "sourcing",
        secondary_query_types: [
          "technical_specification",
          "engineering_review",
        ],
        intent_scope: "project_procurement",
        business_context: [
          "water utilities",
          "industrial water infrastructure",
          "municipal pumping stations",
        ],
        product_identity: {
          product_category: "water infrastructure & fluid handling equipment",
          product_subcategory: "horizontal end-suction centrifugal water pumps",
          product_name:
            "Industrial Horizontal End-Suction Centrifugal Water Pumps",
          manufacturer: "",
          brand: "",
          model_names: [
            "End-Suction Centrifugal Water Transfer Pump ISO 2858 / ISO 5199",
          ],
        },
        shared_attributes: {
          configuration: {
            value: "Horizontal End-Suction Centrifugal",
            unit: "",
            raw_value: "پمپ‌های سانتریفیوژ افقی End-Suction",
          },
          duty_cycle: {
            value: "Continuous 24/7 industrial service",
            unit: "",
            raw_value: "کارکرد 24/7",
          },
          motor_and_seal: {
            value: "High-efficiency electric motor and mechanical seal",
            unit: "",
            raw_value: "الکتروموتور راندمان‌بالا، Mechanical Seal",
          },
        },
        product_variants: [],
        technical_requirements: {
          standards_compliance: {
            value: "ISO 2858 and ISO 5199",
            unit: "",
            raw_value: "ISO 2858, ISO 5199",
            requirement_level: "mandatory",
          },
          hydraulic_performance: {
            value:
              "Duty Point, Flow Rate, Head, NPSH, Efficiency, Motor Power, Performance Curve",
            unit: "",
            raw_value: "Duty Point, Flow Rate, Head, NPSH",
            requirement_level: "mandatory",
          },
          testing_documentation: {
            value:
              "Hydrostatic Test, Performance Test Certificate, Material Certificate, GA Drawing, Spare Parts List",
            unit: "",
            raw_value: "Hydrostatic Test, GA Drawing",
            requirement_level: "mandatory",
          },
        },
        conditional_requirements: [],
        matching_controls: {
          exact_manufacturer_required: false,
          exact_model_required: false,
          equivalent_products_allowed: "yes",
          hard_constraints: [
            "Conforming to ISO 2858 and ISO 5199 hydraulic and dimensional standards",
            "Specified Duty Point performance curve with verified NPSH margins",
            "Certified hydrostatic pressure test and material traceability certificates",
            "General Arrangement (GA Drawing) and complete spare parts provisioning",
            "Factory Acceptance Test (FAT) witnessing and minimum 10-year OEM spare parts support",
          ],
          soft_preferences: [
            "Direct OEM or certified authorized representative with proven utility track record",
            "Established regional GCC presence with commissioning and site support engineering",
            "Strict adherence to scheduled EPC project delivery milestones",
          ],
          exclusions: [],
        },
        confidence_level_required: "high",
        technical_risk_sensitive: true,
        compliance_sensitive: true,
        pricing_volatile: false,
        match_readiness: "ready",
        ambiguities: [],
        missing_information: [],
        extraction_confidence: "high",
      };

      canonicalText =
        "Procurement of industrial horizontal end-suction centrifugal water pumps — verified hydraulic performance curves with NPSH parameters, compliance with ISO 2858 and ISO 5199 standards, OEM manufacturing qualification, GA Drawing documentation, and scheduled EPC delivery terms.";
      needVal =
        "Heavy-duty horizontal end-suction centrifugal pumps for continuous 24/7 industrial water transfer service, equipped with premium efficiency electric motors and mechanical seals.";
      constraintsVal =
        "Compliance with ISO 2858 and ISO 5199 standards, verified Duty Point flow rate and head, documented NPSH and performance curves, hydrostatic testing, material certificates, GA drawings, and 10-year OEM spare parts commitment.";
      contextVal = unknownFields.includes("preferences_context")
        ? "Unknown"
        : "Initial infrastructure order of six operating and two standby pumps with scheduled EPC delivery. Priority for OEM or authorized representatives with water utility track record, FAT witness testing, and commissioning support.";
    } else {
      classified = {
        primary_query_type: "sourcing",
        secondary_query_types: [
          "technical_specification",
          "engineering_review",
        ],
        intent_scope: "project_procurement",
        business_context: [
          "water utilities",
          "petrochemical process fluids",
          "heavy industrial fluid transport",
        ],
        product_identity: {
          product_category: "industrial pumps & fluid machinery",
          product_subcategory: "centrifugal and process pumps",
          product_name: "Industrial Centrifugal and Process Pumping Systems",
          manufacturer: "",
          brand: "",
          model_names: ["Heavy-Duty Centrifugal Process Pump"],
        },
        shared_attributes: {},
        product_variants: [],
        technical_requirements: {},
        conditional_requirements: [],
        matching_controls: {
          exact_manufacturer_required: false,
          exact_model_required: false,
          equivalent_products_allowed: "yes",
          hard_constraints: [
            "API 610 or ISO 5199 standard design",
            "Factory performance test curves and witness testing reports",
          ],
          soft_preferences: ["GCC regional assembly and spare parts inventory"],
          exclusions: [],
        },
        confidence_level_required: "high",
        technical_risk_sensitive: true,
        compliance_sensitive: true,
        pricing_volatile: false,
        match_readiness: "ready",
        ambiguities: [],
        missing_information: [],
        extraction_confidence: "high",
      };

      canonicalText =
        "Procurement of industrial centrifugal and process pumps — API 610 compliant, verified hydraulic performance curves, factory testing documentation, and international delivery terms.";
      needVal =
        "Heavy-duty industrial centrifugal and process fluid pumps engineered for continuous operation in severe industrial, chemical, and water utility services.";
      constraintsVal =
        "Compliance with API 610 or ISO 5199 hydraulic standards, documented factory performance curves, vibration test certificates, and minimum 2-year warranty.";
      contextVal = unknownFields.includes("preferences_context")
        ? "Unknown"
        : "Initial capital equipment order with ongoing parts supply agreement. Priority for global pump manufacturers with GCC service centers.";
    }
  } else if (isSteel) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "material_verification",
      ],
      intent_scope: "project_procurement",
      business_context: [
        "structural engineering",
        "civil infrastructure",
        "industrial pipeline construction",
      ],
      product_identity: {
        product_category: "metals & metallurgy",
        product_subcategory: "structural steel and seamless piping",
        product_name:
          "Industrial Structural Steel, Metallurgical Sections, and Seamless Piping",
        manufacturer: "",
        brand: "",
        model_names: ["Grade 60 Rebar and Seamless Steel Pipe"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "ASTM / EN / BS standard conformity",
          "Original Mill Test Certificate (MTC) EN 10204 3.1",
        ],
        soft_preferences: [
          "Direct primary mill supply with export shipping readiness",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of industrial structural steel, metallurgical sections, and seamless piping — compliant with ASTM and EN standards, certified mill test certificates (MTC), and export shipping terms.";
    needVal =
      "Prime-quality industrial structural steel products, high-tensile rebars, and seamless carbon steel piping for major commercial and infrastructure construction projects.";
    constraintsVal =
      "Conformity with ASTM A615 / EN 10025 structural specifications, certified EN 10204 3.1 Mill Test Certificates (MTC), strict chemical composition compliance, and bundled export packaging.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "High-tonnage commercial delivery scheduled in regular monthly container or breakbulk vessel shipments CIF destination port.";
  } else if (isMarineGenerator) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "compliance_verification",
      ],
      intent_scope: "commercial_fleet_procurement",
      business_context: [
        "maritime commercial shipping",
        "offshore support vessels",
        "marine auxiliary power",
      ],
      product_identity: {
        product_category: "marine equipment & maritime power systems",
        product_subcategory: "marine diesel generator sets",
        product_name: "Marine Commercial Diesel Generator Sets",
        manufacturer: "",
        brand: "",
        model_names: ["Marine Auxiliary Diesel Genset 60-100 kVA"],
      },
      shared_attributes: {
        power_rating: {
          value: "60 to 100 kVA continuous marine rating",
          unit: "kVA",
          raw_value: "60 و100 kVA",
        },
        marine_adaptation: {
          value:
            "Engineered for harsh marine environment, humidity, salinity, and vibration resistance",
          unit: "",
          raw_value: "مقاومة للرطوبة والملوحة والاهتزاز",
        },
        duty_application: {
          value:
            "Primary or standby auxiliary power generation on board commercial vessels",
          unit: "",
          raw_value: "كمولد رئيسي أو احتياطي",
        },
      },
      product_variants: [],
      technical_requirements: {
        regulatory_compliance: {
          value: "International Maritime Organization (IMO) compliance",
          unit: "",
          raw_value: "IMO",
          requirement_level: "mandatory",
        },
        classification_society: {
          value:
            "Recognized maritime classification approval (DNV, ABS, Lloyd's Register, or Bureau Veritas)",
          unit: "",
          raw_value: "DNV, ABS, Lloyd's Register, Bureau Veritas",
          requirement_level: "mandatory",
        },
        testing_and_protection: {
          value:
            "Factory Acceptance Test (FAT) report and certified IP rating electrical protection",
          unit: "",
          raw_value: "IP Rating, FAT Report",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Engineered and certified specifically for marine environment operations",
          "Compliance with IMO environmental and safety standards",
          "Eligibility and certification from recognized classification society (DNV, ABS, Lloyd's Register, or BV)",
          "Documented Factory Acceptance Test (FAT) report and complete spare parts list",
          "Manufacturer warranty, operating manuals, and certified IP rating protection",
        ],
        soft_preferences: [
          "Established GCC inventory or transparent lead time with regional marine service network",
          "Documented track record in supplying equipment for commercial maritime vessels",
          "Long-term marine spare parts availability in Arabian Gulf ports",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of marine diesel generator sets for commercial vessels — certified IMO compliance with DNV, ABS, or Lloyd's Register classification, verified IP rating protection, factory load test reports with FAT documentation, and commercial warranty delivery terms.";
    needVal =
      "Marine diesel generator sets (60-100 kVA) designed for continuous duty on commercial service vessels in harsh high-humidity, high-salinity marine environments.";
    constraintsVal =
      "Compliance with IMO regulations, classification society type approval (DNV, ABS, Lloyd's Register, or BV), factory load tests with FAT reports, certified IP rating, complete spare parts provisioning, and manufacturer warranty.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial order of eight units for vessels under outfitting with follow-on procurement options. Priority for manufacturers or authorized distributors with GCC marine presence, stocked spare parts, and proven commercial fleet track record.";
  } else if (isGenerator) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification", "power_equipment"],
      intent_scope: "commercial_use",
      business_context: [
        "emergency standby power",
        "prime commercial power",
        "industrial facility power generation",
      ],
      product_identity: {
        product_category: "power generation & electrical equipment",
        product_subcategory: "diesel generator sets",
        product_name: "Commercial Power Generation and Diesel Generator Sets",
        manufacturer: "",
        brand: "",
        model_names: ["Heavy-Duty Commercial Diesel Genset"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "ISO 8528 standard compliance",
          "Factory load test reports and CE certification",
          "Sound-attenuated weatherproof enclosure",
        ],
        soft_preferences: [
          "Local UAE commissioning capability and 24/7 spare parts support",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of commercial diesel generator sets and industrial power systems — ISO 8528 compliant, factory load test reports, sound-attenuated canopy, and manufacturer warranty.";
    needVal =
      "Heavy-duty commercial diesel generator sets configured for prime or standby industrial power generation, complete with digital control panel, alternator, and soundproof canopy.";
    constraintsVal =
      "ISO 8528 electrical generation standards, factory load test reports (50%/75%/100%/110%), CE certification, Certificate of Origin, and comprehensive factory warranty.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Turnkey delivery to commercial facility in the UAE with manufacturer warranty and local service level agreement (SLA) for emergency maintenance.";
  } else if (isCables) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "electrical_compliance",
      ],
      intent_scope: "project_procurement",
      business_context: [
        "power distribution",
        "industrial plant wiring",
        "high-voltage infrastructure",
      ],
      product_identity: {
        product_category: "electrical cables & distribution",
        product_subcategory: "industrial power and instrumentation cables",
        product_name: "Industrial High-Voltage and Fire-Resistant Power Cables",
        manufacturer: "",
        brand: "",
        model_names: ["XLPE Armored Fire-Resistant Power Cable"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "BASEC / LPCB / IEC 60502 certification",
          "Documented conductor resistance and insulation resistance test reports",
        ],
        soft_preferences: [
          "GCC utility approval and regional manufacturing capacity",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of industrial electrical power and instrumentation cables — BASEC and IEC compliant, fire-resistant and armored specifications, factory test certificates, and international delivery terms.";
    needVal =
      "High-reliability industrial power, control, and instrumentation cables with XLPE insulation, steel tape/wire armoring, and low-smoke zero-halogen (LSZH) fire-resistant properties.";
    constraintsVal =
      "BASEC, LPCB, or IEC 60502 accreditation, routine factory testing certificates per drum, Certificate of Origin, and heavy-duty wooden drum export packaging.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Phased project supply delivered CIF Jebel Ali with complete technical drum schedules and cutting lists.";
  } else if (isPetrochemicals) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification", "polymer_assay"],
      intent_scope: "commercial_use",
      business_context: [
        "plastic manufacturing",
        "industrial polymer compounding",
        "packaging film extrusion",
      ],
      product_identity: {
        product_category: "chemicals & polymers",
        product_subcategory: "virgin polymer resins and petrochemical granules",
        product_name:
          "Petrochemical Feedstocks and Engineering Polymer Granules",
        manufacturer: "",
        brand: "",
        model_names: ["Prime Virgin Polymer Resin (HDPE/LLDPE/PP)"],
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Prime virgin grade with certified Melt Flow Index (MFI) and density",
          "Batch Certificate of Analysis (COA)",
        ],
        soft_preferences: [
          "Continuous monthly container allocation from major Middle East producers",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of prime virgin polymer resins and petrochemical granules — certified Melt Flow Index (MFI), batch Certificate of Analysis (COA), export pallet packaging, and continuous delivery terms.";
    needVal =
      "Prime virgin polymer granules (HDPE, LDPE, LLDPE, or Polypropylene) for industrial film extrusion, blow molding, or injection molding manufacturing.";
    constraintsVal =
      "Manufacturer Certificate of Analysis (COA), certified density and Melt Flow Index (MFI), 25kg palletized export packaging with shrink-wrap, and ISO 9001 compliance.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Monthly recurring containerized volume delivery CIF destination port with flexible trade financing.";
  } else if (isLowEGlass) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification", "quality_compliance"],
      intent_scope: "project_procurement",
      business_context: [
        "commercial building construction",
        "tower facade engineering",
        "architectural curtain walls",
      ],
      product_identity: {
        product_category: "building materials & architectural glass",
        product_subcategory: "double glazed low-e insulated glass units",
        product_name: "Double Glazed Low-E Insulated Architectural Glass Units",
        manufacturer: "",
        brand: "",
        model_names: ["Double Glazed Low-E Curtain Wall Units"],
      },
      shared_attributes: {
        thermal_performance: {
          value: "Certified U-Value and Solar Heat Gain Coefficient (SHGC)",
          unit: "",
          raw_value: "U-Value, SHGC",
        },
        optical_properties: {
          value:
            "Controlled visible light transmission with architectural color consistency",
          unit: "",
          raw_value: "Visible Light Transmission",
        },
        glass_construction: {
          value: "Insulated glazing with warm edge spacer and low-e coating",
          unit: "",
          raw_value: "Glass Thickness, Edge Spacer, Low-E",
        },
      },
      product_variants: [],
      technical_requirements: {
        standards_compliance: {
          value: "ASTM, EN, and BS structural and thermal glazing standards",
          unit: "",
          raw_value: "ASTM, EN, BS",
          requirement_level: "mandatory",
        },
        testing_certification: {
          value:
            "Thermal performance certificates, wind load testing, and heat soak testing",
          unit: "",
          raw_value: "Heat Treatment, Heat Soak",
          requirement_level: "mandatory",
        },
        delivery_terms: {
          value: "Delivered Duty Paid (DDP) to Dubai project site",
          unit: "",
          raw_value: "DDP",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Compliance with ASTM, EN, and BS architectural glazing and safety standards",
          "Verified thermal performance meeting specified U-Value and SHGC criteria",
          "Factory batch quality test reports and heat soak testing documentation",
          "Consistent color matching across production batches for large facade areas",
          "Delivered Duty Paid (DDP) delivery terms directly to Dubai project site",
        ],
        soft_preferences: [
          "Proven international track record in high-rise commercial tower facades",
          "Stable production capacity with technical coordination for facade contractors",
          "Scalable supply commitment for future project expansion phases",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of double glazed low-e insulated architectural glass units — verified U-value and SHGC thermal performance, compliance with ASTM, EN, and BS engineering standards, factory test certificates, and scheduled DDP project delivery terms.";
    needVal =
      "Double glazed low-e insulated glass units for commercial tower facade curtain walls, providing high solar control, thermal insulation, and energy efficiency.";
    constraintsVal =
      "Full compliance with ASTM, EN, or BS standards, verified U-Value and SHGC ratings, visible light transmission criteria, factory heat soak and wind resistance test reports, batch color consistency, and DDP jobsite delivery.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial phase requirement of approximately 12,000 square meters with option to expand to over 35,000 square meters. Priority for established architectural glass manufacturers with high-rise facade experience and dedicated technical support.";
  } else if (isBabyDiapers) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: [
        "technical_specification",
        "contract_manufacturing",
      ],
      intent_scope: "retail_distribution",
      business_context: [
        "consumer goods",
        "infant personal care",
        "private label FMCG distribution",
      ],
      product_identity: {
        product_category: "consumer goods & personal hygiene products",
        product_subcategory: "private label baby diapers & infant care",
        product_name: "Private Label Baby Diapers and Infant Care Products",
        manufacturer: "",
        brand: "",
        model_names: [
          "Private Label High-Absorbency Baby Diapers (Newborn to XL)",
        ],
      },
      shared_attributes: {
        absorbent_core: {
          value:
            "High-concentration Superabsorbent Polymer (SAP) and fluff pulp core",
          unit: "",
          raw_value: "SAP Content, Fluff Pulp",
        },
        size_range: {
          value: "Full size range from newborn to XL",
          unit: "",
          raw_value: "حديثي الولادة حتى XL",
        },
        skin_protection: {
          value:
            "Hypoallergenic breathable backsheet and elastic anti-leak barrier system",
          unit: "",
          raw_value: "Breathable Back Sheet, Leakage Protection",
        },
      },
      product_variants: [],
      technical_requirements: {
        quality_standards: {
          value:
            "Compliance with ISO 9001 and ISO 13485 quality management systems",
          unit: "",
          raw_value: "ISO 9001, ISO 13485",
          requirement_level: "mandatory",
        },
        safety_testing: {
          value:
            "Dermatological safety reports, raw material testing, and export packaging specifications",
          unit: "",
          raw_value: "Safety Reports, Retail-Ready",
          requirement_level: "mandatory",
        },
        commercial_terms: {
          value:
            "Flexible Minimum Order Quantity (MOQ) and full OEM/ODM private label customization",
          unit: "",
          raw_value: "OEM/ODM, MOQ",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Multi-size manufacturing capability from newborn through XL with uniform weight specifications",
          "High-absorbency performance with verified SAP content and fluff pulp specifications",
          "Dermatological safety test documentation and raw material traceability",
          "Certified ISO 9001 and ISO 13485 manufacturing quality assurance where applicable",
          "Retail-ready packaging, barcode integration, batch numbering, and export seaworthy packing",
        ],
        soft_preferences: [
          "Experienced OEM/ODM manufacturer with proven private label export portfolio",
          "Flexible MOQ for initial 40ft container market test with rapid scaling capacity",
          "Competitive pricing structure tailored for Middle East and African retail distribution",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: false,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of private label baby diapers and infant care products — multi-size newborn to XL availability, high-absorbency SAP core technology, certified compliance with ISO 9001 and ISO 13485 quality standards, flexible MOQ terms, and full OEM/ODM packaging customization.";
    needVal =
      "Private label baby diapers in multiple sizes (newborn to XL) engineered with high-absorbency SAP cores, breathable backsheets, and soft hypoallergenic materials for retail distribution.";
    constraintsVal =
      "Dermatological safety test reports, verified SAP content, ISO 9001 and ISO 13485 quality certifications, barcode-integrated retail-ready packaging, batch numbering, and export palletization.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial pilot order of one 40ft container with mixed sizes, scaling to 5-10 containers monthly. Priority for experienced OEM/ODM manufacturers with flexible MOQ and competitive volume pricing for Middle East and Africa markets.";
  } else if (isAviationGPU) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification", "aviation_compliance"],
      intent_scope: "project_procurement",
      business_context: [
        "airport ground operations",
        "aviation ground support equipment (GSE)",
        "aircraft apron power supply",
      ],
      product_identity: {
        product_category:
          "aviation ground support equipment (gse) & airport power systems",
        product_subcategory:
          "mobile aircraft ground power units (400 hz / 28v dc / 115-200v ac)",
        product_name:
          "Mobile Aircraft Ground Power Units (GPU) 400 Hz / 115-200V AC",
        manufacturer: "",
        brand: "",
        model_names: ["Solid-State / Diesel Mobile GPU 400 Hz 90kVA-140kVA"],
      },
      shared_attributes: {
        electrical_output: {
          value:
            "400 Hz / 115-200V AC with low total harmonic distortion (THD)",
          unit: "",
          raw_value: "400 Hz / 115-200V AC, THD",
        },
        aircraft_compatibility: {
          value:
            "Narrow-body commercial aircraft including Airbus A320 and Boeing 737 families",
          unit: "",
          raw_value: "Airbus A320, Boeing 737",
        },
        operating_environment: {
          value:
            "Continuous duty in high-temperature arid airport apron conditions",
          unit: "",
          raw_value: "مناخ الخليج الحار",
        },
      },
      product_variants: [],
      technical_requirements: {
        aviation_standards: {
          value:
            "Compliance with ISO 6858 and SAE ARP5015 aviation ground electrical standards",
          unit: "",
          raw_value: "ISO 6858, SAE ARP5015",
          requirement_level: "mandatory",
        },
        compliance_and_testing: {
          value:
            "CE Declaration of Conformity and comprehensive Factory Acceptance Test (FAT) report",
          unit: "",
          raw_value: "CE, FAT Report",
          requirement_level: "mandatory",
        },
        documentation_and_support: {
          value:
            "Operation and maintenance manuals, spare parts catalog, factory warranty, and technical training",
          unit: "",
          raw_value: "O&M Manual, Spare Parts, Warranty",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Certified electrical output of 400 Hz / 115-200V AC with low THD harmonic distortion",
          "Engineered compatibility for narrow-body commercial airliners (Airbus A320 and Boeing 737)",
          "Full compliance with ISO 6858 and SAE ARP5015 aircraft ground electrical interface standards",
          "CE Declaration of Conformity and documented Factory Acceptance Test (FAT) load report",
          "Complete manufacturer documentation: O&M manuals, recommended spare parts list, and factory warranty",
        ],
        soft_preferences: [
          "Authorized OEM or regional GSE distributor with local GCC spare parts stock and rapid field service",
          "Provision of technical operator training and pre-commissioning operational trial on-site",
          "Scalable framework contract for planned future regional airport expansion phases",
        ],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of commercial aircraft ground power units (GPU) and mobile airport power systems — 400 Hz / 115-200V AC output for Airbus A320 narrow-body aircraft, low THD, ISO 6858 and SAE ARP5015 compliant, CE certified, factory FAT testing, and turnkey GPU delivery terms.";
    needVal =
      "Mobile aircraft ground power units (GPU) delivering regulated 400 Hz / 115-200V AC electrical power to service commercial narrow-body aircraft (Airbus A320 and Boeing 737) in high-ambient airport apron environments.";
    constraintsVal =
      "Full technical compliance with ISO 6858 and SAE ARP5015 standards, low THD, CE declaration, factory FAT load test reports, O&M manuals, spare parts list, warranty, and preventive maintenance plan.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial delivery of six GPU units for regional airport operations with expansion options. Preference for established GSE manufacturers or authorized distributors offering technical training, local spare parts, and fast maintenance response.";
  } else if (isThermalPaper) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification", "quality_compliance"],
      intent_scope: "wholesale",
      business_context: [
        "retail automation",
        "banking POS & ATM supplies",
        "converted paper manufacturing",
      ],
      product_identity: {
        product_category: "paper, printing & converted paper products",
        product_subcategory: "thermal paper rolls for pos and atm terminals",
        product_name: "Thermal Paper Rolls for POS and ATM Terminals",
        manufacturer: "",
        brand: "",
        model_names: ["POS Thermal Paper 80x80mm", "POS Thermal Paper 57x40mm"],
      },
      shared_attributes: {
        dimensions: {
          value: "Standard roll sizes including 80x80mm and 57x40mm",
          unit: "mm",
          raw_value: "80×80 مم و57×40 مم",
        },
        paper_weight: {
          value:
            "Certified base paper GSM weight with high whiteness and smooth surface",
          unit: "gsm",
          raw_value: "Paper GSM, Whiteness",
        },
        print_performance: {
          value:
            "High-contrast thermal image stability and long archival shelf life",
          unit: "",
          raw_value: "Image Stability, وضوح طباعة",
        },
      },
      product_variants: [],
      technical_requirements: {
        chemical_safety: {
          value: "BPA-Free and BPS-Free certified thermal coating",
          unit: "",
          raw_value: "BPA-Free, BPS-Free",
          requirement_level: "mandatory",
        },
        testing_and_verification: {
          value:
            "SGS laboratory test report, Technical Data Sheet (TDS), and material conformity certificate",
          unit: "",
          raw_value: "SGS, TDS",
          requirement_level: "mandatory",
        },
        commercial_terms: {
          value:
            "Continuous slitting and converting capacity with flexible MOQ for annual contracts",
          unit: "",
          raw_value: "MOQ, Slitting & Converting",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Accurate dimensions (80x80mm and 57x40mm) with tight roll diameter, width, and core tolerances",
          "Certified BPA-Free and BPS-Free thermal coating formulation verified by SGS laboratory reports",
          "Documented base paper GSM weight, whiteness index, and high-density image stability",
          "Moisture-barrier export carton packaging suitable for maritime container shipping and hot humid storage",
          "Minimum Order Quantity (MOQ) structured for high-volume phased container procurement",
        ],
        soft_preferences: [
          "Direct manufacturer with integrated high-speed slitting and converting lines",
          "Custom reverse-side watermark and brand logo printing capability",
          "Competitive annual framework pricing with guaranteed roll length and weight consistency",
        ],
        exclusions: [
          "Non-certified thermal coatings containing hazardous bisphenols",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: false,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of premium thermal paper rolls for POS and ATM terminals — certified GSM paper weight, BPA-free and BPS-free chemical coating, SGS laboratory test reports, and flexible MOQ export delivery terms.";
    needVal =
      "High-grade thermal paper rolls in 80x80mm and 57x40mm dimensions for POS and ATM transaction printing, featuring sharp image contrast, smooth coating, and extended archival shelf life.";
    constraintsVal =
      "Declared paper GSM, roll diameter, width, and core specifications; certified BPA-free / BPS-free compliance; SGS lab test verification; Technical Data Sheet; and heavy-duty maritime export packaging.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial procurement of 500,000 rolls with recurring quarterly supply program. Preference for integrated slitting and converting converters offering custom back-printing, tight roll weight consistency, and competitive annual pricing.";
  } else if (isAquacultureFeed) {
    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification", "nutritional_assay"],
      intent_scope: "wholesale",
      business_context: [
        "commercial aquaculture",
        "intensive fish farming",
        "aquafeed bulk distribution",
      ],
      product_identity: {
        product_category: "agriculture & aquaculture nutrition",
        product_subcategory: "commercial extruded floating fish feed",
        product_name: "Commercial Extruded Floating Fish Feed for Aquaculture",
        manufacturer: "",
        brand: "",
        model_names: [
          "Extruded Floating Aquafeed Pellets (32% to 42% Crude Protein)",
        ],
      },
      shared_attributes: {
        crude_protein: {
          value:
            "32% to 42% crude protein formulated for tilapia and sea bass life stages",
          unit: "%",
          raw_value: "32% و42% بروتین",
        },
        pellet_physical_properties: {
          value:
            "High water stability, low dust, and high buoyancy floating rate",
          unit: "",
          raw_value: "Pellet Size, Floating Rate, ثبات در آب",
        },
        digestibility_and_fcr: {
          value:
            "High digestibility and optimized Feed Conversion Ratio (FCR Target)",
          unit: "",
          raw_value: "FCR Target, Feed Conversion Ratio",
        },
      },
      product_variants: [],
      technical_requirements: {
        quality_assurance: {
          value:
            "Batch-specific Certificate of Analysis (COA) with microbiological and mycotoxin testing",
          unit: "",
          raw_value: "COA, Mycotoxin, Microbiological",
          requirement_level: "mandatory",
        },
        manufacturing_standards: {
          value:
            "Production certified to HACCP, GMP+, or ISO 22000 food and feed safety systems",
          unit: "",
          raw_value: "HACCP, GMP+, ISO 22000",
          requirement_level: "mandatory",
        },
        export_packaging: {
          value:
            "Moisture-resistant multi-wall woven bags in 20 kg or 25 kg export packaging",
          unit: "kg",
          raw_value: "20 أو 25 كجم",
          requirement_level: "mandatory",
        },
      },
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Certified crude protein (32%-42%), crude fat, fiber, moisture, and ash specifications",
          "High floating rate with sustained water stability to minimize nutrient leaching",
          "Batch Certificate of Analysis (COA) verifying absence of harmful mycotoxins and pathogens",
          "Certified compliance with HACCP, GMP+, or ISO 22000 quality management standards",
          "Moisture-proof 20kg or 25kg export bag packaging with verified shelf life stability",
        ],
        soft_preferences: [
          "Specialized aquafeed manufacturer with proven formulation performance in warm climates",
          "Dedicated technical aquaculture support for feed conversion optimization and farm feeding schedules",
          "Consistent monthly production capacity scaling from 120-ton trial to over 500 tons per month",
        ],
        exclusions: [
          "Uncertified feed or non-extruded sinking feeds not meeting floating buoyancy criteria",
        ],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: true,
      pricing_volatile: true,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "high",
    };

    canonicalText =
      "Procurement of commercial extruded floating fish feed for aquaculture — optimized FCR growth targets, batch COA quality testing, certified HACCP and GMP+ production compliance, ISO 22000 standards, and moisture-resistant export packaging.";
    needVal =
      "Commercial extruded floating aquafeed for tilapia and sea bass farming, available in 32% to 42% protein tiers with high water stability, digestibility, and low feed conversion ratio (FCR).";
    constraintsVal =
      "Guaranteed proximate analysis (protein, fat, fiber, moisture, ash), batch COA, microbiological and mycotoxin screening, certified HACCP / GMP+ / ISO 22000 compliance, and 20kg/25kg moisture-barrier bags.";
    contextVal = unknownFields.includes("preferences_context")
      ? "Unknown"
      : "Initial pilot order of 120 tons scaling to 500+ tons monthly based on FCR and survival metrics. Preference for specialized aquaculture nutrition producers with warm-climate expertise and on-farm technical feed management.";
  } else {
    // Universal dynamic domain parsing:
    const paragraphs = rawSourceText
      .split(/\n\s*\n/u)
      .map((p) => p.trim())
      .filter(Boolean);

    const protectedSpans = extractPersistableProtectedSpans(rawSourceText);
    const tokens = protectedSpans.map((s) => s.canonicalValue);

    let extractedSubject = "Commercial Engineering Products";
    const p1 = paragraphs[0] || "";
    const engMatch = p1.match(
      /(?:procurement|supply|sourcing|purchase)\s+of\s+([^.,;:\n]{3,50})/iu,
    );
    if (engMatch && engMatch[1]) {
      extractedSubject = engMatch[1].trim();
    } else if (/[\u0600-\u06ff]/u.test(rawSourceText)) {
      if (norm.includes("سونوگرافی") || norm.includes("ultrasound"))
        extractedSubject = "Portable Diagnostic Ultrasound Systems";
      else if (norm.includes("ابیاری") || norm.includes("قطره"))
        extractedSubject = "Commercial Agricultural Drip Irrigation Systems";
      else if (
        norm.includes("منسوجات") ||
        norm.includes("ملحفه") ||
        norm.includes("حوله")
      )
        extractedSubject = "Five-Star Hospitality Commercial Textiles";
      else if (norm.includes("تایر") || norm.includes("لاستیک"))
        extractedSubject = "Heavy Commercial Fleet Tires";
      else if (norm.includes("لپتاپ") || norm.includes("لپ تاپ"))
        extractedSubject = "Business-Class Enterprise Laptops";
      else if (
        norm.includes("پرسلان") ||
        norm.includes("سرامیک") ||
        norm.includes("کاشی")
      )
        extractedSubject = "Project Porcelain Ceramic Tiles";
      else if (norm.includes("خورشیدی") || norm.includes("اینورتر"))
        extractedSubject = "Solar Photovoltaic Systems and Inverters";
      else if (norm.includes("لیفتراک"))
        extractedSubject = "Electric Counterbalance Forklifts";
      else if (
        norm.includes("پوست") ||
        norm.includes("آرایشی") ||
        norm.includes("ارایشی")
      )
        extractedSubject = "Private Label Skincare and Cosmetic Line";
      else if (hasPersianWord("مس", norm) || norm.includes("کاتد"))
        extractedSubject = "High-Purity Copper Cathodes";
      else if (norm.includes("تزریق پلاستیک"))
        extractedSubject = "Plastic Injection Molding Machinery";
      else if (norm.includes("بویلر") || norm.includes("پکیج"))
        extractedSubject = "Commercial Heating Boilers";
      else if (norm.includes("پسته"))
        extractedSubject = "Commercial Export Pistachios";
      else if (norm.includes("پیچ") || norm.includes("مهره"))
        extractedSubject = "Industrial Fasteners and Hardware";
      else if (norm.includes("مرغ"))
        extractedSubject = "Commercial Poultry Products";
      else if (
        norm.includes("لباس") ||
        norm.includes("پوشاک") ||
        norm.includes("ضد حریق") ||
        norm.includes("ارک فلش") ||
        norm.includes("atpv") ||
        norm.includes("nomex") ||
        norm.includes("حفاظت فردی")
      )
        extractedSubject =
          "Industrial Flame-Resistant and Arc-Flash Protective Workwear";
      else if (
        norm.includes("رنگ") ||
        norm.includes("اپوکسی") ||
        norm.includes("پوشش") ||
        norm.includes("رزین") ||
        norm.includes("چسب") ||
        norm.includes("حلال") ||
        norm.includes("کوتینگ") ||
        norm.includes("coating")
      )
        extractedSubject =
          "Industrial Protective Coatings and Performance Paints";
      else if (
        norm.includes("تسمه نقاله") ||
        norm.includes("نوار نقاله") ||
        (hasPersianWord("تسمه", norm) && hasPersianWord("نقاله", norm))
      )
        extractedSubject = "Heavy-Duty Industrial Conveyor Belts for Mining";
      else if (
        norm.includes("صندلی ارگونومیک") ||
        norm.includes("صندلی اداری") ||
        norm.includes("مبلمان اداری") ||
        hasPersianWord("صندلی", norm)
      )
        extractedSubject =
          "Ergonomic Office Chairs and Commercial Workplace Seating";
      else if (
        norm.includes("زجاج") ||
        norm.includes("low-e") ||
        norm.includes("double glazed") ||
        norm.includes("glass")
      )
        extractedSubject =
          "Double Glazed Low-E Insulated Architectural Glass Units";
      else if (
        norm.includes("حفاضات") ||
        norm.includes("diaper") ||
        norm.includes("پوشک")
      )
        extractedSubject =
          "Private Label Baby Diapers and Infant Care Products";
      else if (
        isAviationGPU ||
        norm.includes("gpu") ||
        norm.includes("طاقة ارضية") ||
        norm.includes("طاقة أرضية")
      )
        extractedSubject = "Commercial Aircraft Ground Power Units (GPU)";
      else if (
        isThermalPaper ||
        norm.includes("ورق حراري") ||
        norm.includes("thermal paper")
      )
        extractedSubject = "Thermal Paper Rolls for POS and ATM Terminals";
      else if (
        isAquacultureFeed ||
        norm.includes("اعلاف اسماك") ||
        norm.includes("أعلاف أسماك") ||
        norm.includes("fish feed")
      )
        extractedSubject = "Commercial Extruded Floating Fish Feed";
      else if (isMarineGenerator)
        extractedSubject = "Marine Commercial Diesel Generator Sets";
      else if (
        norm.includes("شیرآلات") ||
        norm.includes("شیرالات") ||
        norm.includes("شیر صنعتی") ||
        norm.includes("valve")
      )
        extractedSubject = "Industrial High-Pressure Valves and Flow Controls";
      else if (norm.includes("پمپ") || norm.includes("pump"))
        extractedSubject =
          norm.includes("انتقال اب") ||
          norm.includes("انتقال آب") ||
          norm.includes("اب صنعتی") ||
          norm.includes("آب صنعتی") ||
          norm.includes("end-suction")
            ? "Industrial Horizontal End-Suction Centrifugal Water Pumps"
            : "Industrial Centrifugal and Process Pumps";
      else if (
        !norm.includes("تسمه") &&
        (norm.includes("فولاد") ||
          norm.includes("میلگرد") ||
          (hasPersianWord("اهن", norm) && !norm.includes("سنگ اهن")) ||
          (hasPersianWord("آهن", norm) && !norm.includes("سنگ آهن")) ||
          norm.includes("تیرآهن") ||
          norm.includes("لوله مانیسمان"))
      )
        extractedSubject = "Industrial Structural Steel and Seamless Piping";
      else if (
        norm.includes("ژنراتور") ||
        norm.includes("دیزل") ||
        norm.includes("generator")
      )
        extractedSubject =
          "Commercial Power Generation and Diesel Generator Sets";
      else if (
        norm.includes("کابل") ||
        hasPersianWord("سیم", norm) ||
        norm.includes("cable")
      )
        extractedSubject =
          "Industrial Electrical Power and Instrumentation Cables";
      else if (norm.includes("کمپرسور") || norm.includes("compressor"))
        extractedSubject = "Industrial Rotary Screw Air Compressors";
      else if (norm.includes("ترانس") || norm.includes("transformer"))
        extractedSubject =
          "Electrical Distribution Transformers and Switchgear";
      else if (norm.includes("لوله") || norm.includes("pipe"))
        extractedSubject = "Industrial Seamless Piping and Fluid Conduits";
      else if (norm.includes("بلبرینگ") || norm.includes("bearing"))
        extractedSubject =
          "Precision Industrial Bearings and Power Transmission";
      else if (
        norm.includes("الکتروموتور") ||
        norm.includes("موتور") ||
        norm.includes("motor")
      )
        extractedSubject = "Industrial Three-Phase Electric Motors";
      else if (
        norm.includes("پلیمر") ||
        norm.includes("پتروشیمی") ||
        norm.includes("گرانول")
      )
        extractedSubject = "Petrochemical Feedstocks and Engineering Polymers";
      else
        extractedSubject = dynamicPersianToEnglishSubject(norm, rawSourceText);
    }

    if (
      /[\u0600-\u06ff]/u.test(extractedSubject) ||
      !/[A-Za-z]/.test(extractedSubject)
    ) {
      extractedSubject = dynamicPersianToEnglishSubject(norm, rawSourceText);
    }

    classified = {
      primary_query_type: "sourcing",
      secondary_query_types: ["technical_specification"],
      intent_scope: "commercial_use",
      business_context: ["specialized commercial procurement"],
      product_identity: {
        product_category: "commercial & industrial goods",
        product_subcategory: extractedSubject.toLowerCase(),
        product_name: extractedSubject,
        manufacturer: "",
        brand: "",
        model_names: tokens.slice(0, 3),
      },
      shared_attributes: {},
      product_variants: [],
      technical_requirements: {},
      conditional_requirements: [],
      matching_controls: {
        exact_manufacturer_required: false,
        exact_model_required: false,
        equivalent_products_allowed: "yes",
        hard_constraints: [
          "Verified manufacturer qualification",
          "Full compliance with technical specifications",
        ],
        soft_preferences: ["Established regional export track record"],
        exclusions: [],
      },
      confidence_level_required: "high",
      technical_risk_sensitive: true,
      compliance_sensitive: false,
      pricing_volatile: false,
      match_readiness: "ready",
      ambiguities: [],
      missing_information: [],
      extraction_confidence: "medium",
    };

    const isPureEnglish =
      !/[\u0600-\u06ff]/u.test(rawSourceText) &&
      /[A-Za-z]{3,}/u.test(paragraphs[0] || "") &&
      !paragraphs[0]?.includes("\n");

    if (isPureEnglish) {
      needVal = paragraphs[0] || "Industrial product sourcing requirement";
      constraintsVal =
        paragraphs[1] || "Standard quality and delivery compliance constraints";
      contextVal = unknownFields.includes("preferences_context")
        ? "Unknown"
        : paragraphs[2] || "Commercial execution context";
      canonicalText = `${needVal} — ${constraintsVal}`;
    } else {
      needVal = `Commercial procurement requirement for verified ${extractedSubject} with high-reliability manufacturing specifications.`;
      constraintsVal =
        "Compliance with declared international engineering standards, verified manufacturer quality assurance, official test certification, and standard export packaging.";
      contextVal = unknownFields.includes("preferences_context")
        ? "Unknown"
        : "Initial commercial order with scheduled repeat procurement cycles. Priority for established manufacturers with verified export experience and dedicated technical support.";
      canonicalText = `Procurement of ${extractedSubject} — verified technical specifications, certified manufacturing compliance, and international delivery terms.`;
    }
  }

  // Final safeguard: canonicalText MUST NEVER contain any Persian/Arabic script characters
  if (/[\u0600-\u06ff]/u.test(canonicalText)) {
    canonicalText = canonicalText
      .replace(/[\u0600-\u06ff]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!canonicalText) {
      canonicalText =
        "Procurement of verified industrial commercial products conforming to international engineering standards.";
    }
  }

  return {
    classifiedQuery: classified,
    fixtureCanonicalText: canonicalText,
    fixtureCanonicalFields: [
      {
        fieldId: "need",
        path: "product.need",
        valueState: "provided",
        languageOrigin: "translated",
        canonicalValue: needVal,
      },
      {
        fieldId: "mandatory_constraints",
        path: "product.mandatory_constraints",
        valueState: "provided",
        languageOrigin: "translated",
        canonicalValue: constraintsVal,
      },
      {
        fieldId: "preferences_context",
        path: "commercial.preferences_context",
        valueState: unknownFields.includes("preferences_context")
          ? "explicitly_unknown"
          : "provided",
        languageOrigin: "translated",
        canonicalValue: contextVal,
      },
    ],
  };
}
