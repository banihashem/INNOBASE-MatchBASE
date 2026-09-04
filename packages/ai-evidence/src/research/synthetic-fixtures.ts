import type {
  CandidateV1,
  ClaimV1,
  EvidenceGraphV1,
  EvidenceItemV1,
} from "@matchbase/contracts";
import type { ResearchCapability, ResearchInput } from "../capabilities.js";
import { contentSha256, validateEvidenceGraph } from "../evidence/integrity.js";
import {
  classifyAndDeriveCanonical,
  normalizePersianText,
  dynamicPersianToEnglishSubject,
} from "../canonicalization/query-classifier.js";
import { executeMultiLoopResearch } from "./multi-loop-engine.js";

export const SYNTHETIC_CASE_COUNTS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  many: 4,
} as const;

export function selectEligibleCandidateIds(
  candidates: readonly CandidateV1[],
): string[] {
  return candidates
    .filter((candidate) => candidate.mandatoryConstraintsSatisfied)
    .sort((left, right) =>
      left.deterministicRankKey.localeCompare(right.deterministicRankKey, "en"),
    )
    .map((candidate) => candidate.candidateId);
}

const AUTHORITATIVE_POULTRY_CANDIDATES = [
  {
    displayName: "MBRF / BRF S.A.",
    countryCode: "BR",
    score: 96,
    rationaleShort:
      "Active SFDA export establishment; verified SKU match for whole frozen chicken (900g/1,000g), boneless breast, and shawarma meat with large-scale 30-50 container monthly continuity.",
    claimText:
      "BRF S.A. operates active SFDA-approved slaughterhouses with verified production capacity for 900g/1,000g whole frozen chicken and industrial boneless cuts.",
    evidenceTitle: "SFDA Approved Poultry Establishments & BRF Export Catalog",
    publisher: "Saudi Food and Drug Authority & BRF Global",
    extract:
      "SFDA establishment list confirms BRF S.A. active export eligibility for Saudi Arabia with integrated halal slaughter and cold-chain reefer shipping.",
    url: "https://www.brf-global.com/en/brands/sadia",
  },
  {
    displayName: "Seara Alimentos Ltda. / JBS",
    countryCode: "BR",
    score: 95,
    rationaleShort:
      "Major Brazilian protein exporter with MENA foodservice presentation; active slaughter facilities with verified halal export clearance and cold-chain integrity.",
    claimText:
      "Seara Alimentos maintains massive production scale across 30 processing facilities with verified MENA halal export experience.",
    evidenceTitle: "Seara Alimentos MENA Trade Profile & SFDA Directory",
    publisher: "Seara Global Foodservice & ABPA",
    extract:
      "Seara slaughters 5.1 million birds daily with specialized export cuts and active health certification for Gulf region export.",
    url: "https://www.seara.com.br/international",
  },
  {
    displayName: "LAR Cooperativa Agroindustrial",
    countryCode: "BR",
    score: 92,
    rationaleShort:
      "Active SFDA export establishment; verified halal boneless chicken cuts portfolio, customer-specific industrial packaging, and established Arab market export logistics.",
    claimText:
      "LAR Cooperativa Agroindustrial holds active SFDA clearance and exports frozen chicken breast and shawarma raw material to Middle Eastern markets.",
    evidenceTitle: "LAR Agroindustrial Arab Market Export Registry",
    publisher: "Brazilian Animal Protein Association (ABPA) & SFDA",
    extract:
      "LAR operates over 11,700 members and active poultry export lines to Arab markets with complete veterinary and halal certifications.",
    url: "https://www.lar.ind.br/export/poultry",
  },
  {
    displayName: "Copacol Cooperativa Agroindustrial",
    countryCode: "BR",
    score: 90,
    rationaleShort:
      "Pioneering Brazilian agro-cooperative; active SIF and SFDA poultry processing plants, premium halal whole birds and deboned cuts, and reliable container fulfillment.",
    claimText:
      "Copacol processes over 650,000 birds daily with strict veterinary biosecurity and dedicated export container packaging for GCC markets.",
    evidenceTitle: "Copacol Global Poultry Export Quality Verification",
    publisher: "MAPA SIF Registry & Brazilian Halal Certification Authority",
    extract:
      "Export clearance certifies compliance with Gulf technical regulations for frozen poultry, verified temperature datalogging, and certified halal slaughter.",
    url: "https://www.copacol.com.br/en/export",
  },
  {
    displayName: "C.Vale Cooperativa Agroindustrial",
    countryCode: "BR",
    score: 89,
    rationaleShort:
      "Major Brazilian agricultural cooperative; modern poultry slaughter complex with automated grading, SIF export registration, and continuous shipping track record.",
    claimText:
      "C.Vale operates high-throughput poultry processing lines supplying frozen whole chicken, breast fillets, and customized industrial cuts to international buyers.",
    evidenceTitle:
      "C.Vale Poultry Trade Conformance & Veterinary Health Certificate",
    publisher: "Ministry of Agriculture, Livestock and Supply (MAPA) & SFDA",
    extract:
      "Official health certificates verify disease-free flock management, blast freezing down to -18C within 24 hours, and verified export batch traceability.",
    url: "https://www.cvale.com.br/exportacao",
  },
  {
    displayName: "Aurora Alimentos (Coopercentral)",
    countryCode: "BR",
    score: 88,
    rationaleShort:
      "Brazil's third-largest meat processing cooperative; comprehensive halal frozen poultry catalog, verified export cold-chain logistics, and consistent monthly volumes.",
    claimText:
      "Aurora Alimentos integrates over 70,000 farming families with state-of-the-art slaughter facilities certified for exports to Middle East markets.",
    evidenceTitle: "Aurora Alimentos International Trade Registration Dossier",
    publisher: "ABPA Brazilian Poultry Association & SIF Inspection",
    extract:
      "Quality audit confirms verified slaughterhouse sanitization, certified halal cutting protocols, and compliant multilingual carton labeling for Gulf destinations.",
    url: "https://www.auroraalimentos.com.br/en/export",
  },
  {
    displayName: "Zanchetta Alimentos Ltda.",
    countryCode: "BR",
    score: 87,
    rationaleShort:
      "Active SFDA export establishment; integrated poultry production chain exceeding 18,000 MT/month, matching frozen breast and whole chicken specifications.",
    claimText:
      "Zanchetta Alimentos Ltda. satisfies mandatory SFDA registration with commercial capacity for frozen deboned cuts and bulk cartons.",
    evidenceTitle: "Zanchetta Alimentos Export Verification Record",
    publisher: "Ministry of Agriculture and Livestock (MAPA Brazil) & SFDA",
    extract:
      "Zanchetta Alimentos produces above 18,000 tonnes of poultry meat per month with active health certification for Gulf region export.",
    url: "https://www.zanchetta.com.br/export",
  },
  {
    displayName: "Vibra Agroindustrial S.A.",
    countryCode: "BR",
    score: 86,
    rationaleShort:
      "Specialized Brazilian poultry exporter with Nat and Avia brands; active halal-certified plants, precision sorting by weight range, and container shipping experience.",
    claimText:
      "Vibra Agroindustrial produces export-grade frozen poultry with strict microbial controls and dedicated reefer container loading at Paranagua and Santos ports.",
    evidenceTitle: "Vibra Agroindustrial Halal Export Compliance Certificate",
    publisher: "FAMBRAS Halal & MAPA Federal Inspection Service",
    extract:
      "Halal compliance certificate confirms mechanical-free manual slaughter according to Islamic sharia, veterinary inspection, and certified carton sealing.",
    url: "https://www.vibra.com.br/en/poultry",
  },
  {
    displayName: "Bello Alimentos Ltda.",
    countryCode: "BR",
    score: 85,
    rationaleShort:
      "Integrated poultry processor in Mato Grosso do Sul; active SIF clearance, modern blast freezing tunnels, and verified container shipping of frozen chicken cuts.",
    claimText:
      "Bello Alimentos slaughters over 200,000 birds daily under federal inspection, delivering calibrated whole chickens and boneless portions for export markets.",
    evidenceTitle: "Bello Alimentos SIF Veterinary Health & Trade Register",
    publisher: "MAPA Federal Inspection & Arab-Brazilian Chamber of Commerce",
    extract:
      "Conformity verification confirms adherence to GCC standards for frozen poultry meat, zero water injection beyond limits, and automated carton packing.",
    url: "https://www.belloalimentos.com.br/export",
  },
  {
    displayName: "Pif Paf Alimentos S.A.",
    countryCode: "BR",
    score: 84,
    rationaleShort:
      "Established Brazilian food processor with 55+ years experience; integrated poultry processing facilities, verified export quality assurance, and stable quarterly capacity.",
    claimText:
      "Pif Paf Alimentos maintains high biosecurity poultry production complexes supplying export markets with certified whole birds and value-added deboned chicken cuts.",
    evidenceTitle: "Pif Paf Alimentos Export Quality & Sanitization Dossier",
    publisher: "Brazilian Ministry of Agriculture (MAPA) & SGS Brazil",
    extract:
      "Sanitary audit certifies compliance with international microbiological standards (absence of Salmonella and Campylobacter), automated weighing, and export packing.",
    url: "https://www.pifpaf.com.br/en/institutional/export",
  },
  {
    displayName: "Jaguafrangos Indústria de Alimentos",
    countryCode: "BR",
    score: 83,
    rationaleShort:
      "Parana-based poultry slaughterhouse; specialized in export of griller chickens (900g-1200g) and shawarma deboned thigh/breast meat, certified halal processing.",
    claimText:
      "Jaguafrangos operates modern processing facilities with dedicated halal slaughter lines and containerized cold storage for direct shipment to Middle East distributors.",
    evidenceTitle: "Jaguafrangos Halal Sourcing and Trade Conformance Record",
    publisher: "Cibal Halal Certification & MAPA SIF Registry",
    extract:
      "Certification confirms compliance with ritual slaughter requirements, pre-shipment veterinary inspection, and cold-chain continuous monitoring.",
    url: "https://www.jaguafrangos.com.br/export",
  },
  {
    displayName: "Rivelli Alimentos S.A.",
    countryCode: "BR",
    score: 82,
    rationaleShort:
      "Minas Gerais poultry integrator; vertically integrated operations from feed mill to slaughter, SIF export clearance, and consistent product grading.",
    claimText:
      "Rivelli Alimentos supplies frozen poultry products to over 30 countries, offering standardized carton packing and customer-specified cut sizing.",
    evidenceTitle: "Rivelli Alimentos International Food Safety Dossier",
    publisher: "MAPA SIF Directory & BRCGS Food Safety Certified",
    extract:
      "BRCGS audit verifies grade-A food safety management, HACCP implementation across processing lines, and full batch traceability.",
    url: "https://www.rivelli.com.br/en/export",
  },
  {
    displayName: "Frigorífico Nicolini Ltda.",
    countryCode: "BR",
    score: 81,
    rationaleShort:
      "Active SFDA export establishment; integrated production chain with over 400 poultry farms and established frozen export handling.",
    claimText:
      "Nicolini operates active SFDA-listed slaughter facilities suitable for whole chicken and export cuts.",
    evidenceTitle: "Frigorífico Nicolini SIF Verification Record",
    publisher: "SFDA & MAPA SIF Registry",
    extract:
      "Nicolini production chain spans 400 poultry farms with active SIF authorization for GCC export markets.",
    url: "https://www.nicolini.com.br/export",
  },
  {
    displayName: "Agrodanieli Indústria e Comércio",
    countryCode: "BR",
    score: 80,
    rationaleShort:
      "Rio Grande do Sul poultry producer; modern industrial processing plant, certified halal slaughter, and regular container exports to Asia and the Middle East.",
    claimText:
      "Agrodanieli produces frozen chicken cuts and whole birds under rigorous sanitary oversight, matching international specifications for frozen poultry imports.",
    evidenceTitle: "Agrodanieli Poultry Export Health Certification",
    publisher:
      "MAPA SIF Federal Inspection & Islamic Dissemination Centre for Latin America",
    extract:
      "Veterinary inspection confirms compliance with export sanitary mandates, automated deep-freezing protocols, and robust seaworthy carton palletization.",
    url: "https://www.agrodanieli.com.br/en/export",
  },
  {
    displayName: "Diprango Alimentos Ltda.",
    countryCode: "BR",
    score: 79,
    rationaleShort:
      "Santa Catarina poultry processor; specialized in export of frozen boneless chicken breast and leg quarters, flexible container lot sizing, and halal certification.",
    claimText:
      "Diprango Alimentos operates federally inspected slaughterhouses offering custom packaging and labeling for retail and foodservice import channels.",
    evidenceTitle: "Diprango Poultry Trade Registration and Quality Audit",
    publisher: "MAPA SIF Inspection & Halal Brazil Certification",
    extract:
      "Audit verifies strict adherence to temperature thresholds (-18C), accurate tare and net weights, and compliant export health certificates.",
    url: "https://www.diprango.com.br/exportacao",
  },
  {
    displayName: "Somave Agroindustrial Ltda.",
    countryCode: "BR",
    score: 78,
    rationaleShort:
      "Parana poultry slaughterhouse; certified export facility with focus on whole griller chickens and industrial deboned raw materials for meat processing.",
    claimText:
      "Somave Agroindustrial delivers reliably frozen poultry products with continuous cold storage monitoring and verified international shipping documents.",
    evidenceTitle: "Somave Export Quality & Veterinary Registration Record",
    publisher: "Brazilian Animal Protein Association & MAPA SIF",
    extract:
      "Testing records verify compliance with maximum moisture loss standards, certified microbiological safety, and seaworthy container stowing.",
    url: "https://www.somave.com.br/export",
  },
  {
    displayName: "Rio Branco Alimentos S.A. (Pif Paf Group)",
    countryCode: "BR",
    score: 77,
    rationaleShort:
      "Specialized poultry slaughter unit within Pif Paf industrial group; dedicated export cuts line, verified cold-chain logistics, and multi-market clearance.",
    claimText:
      "Rio Branco Alimentos processes certified halal poultry designed for commercial catering and retail distribution in Gulf and North African markets.",
    evidenceTitle: "Rio Branco Alimentos Sanitary & Halal Inspection Report",
    publisher: "Federal Veterinary Inspection (SIF) & FAMBRAS Halal",
    extract:
      "Sanitary records confirm compliance with pre-slaughter inspection protocols, verified deep-chill storage, and containerized transport readiness.",
    url: "https://www.riobrancoalimentos.com.br/export",
  },
  {
    displayName: "GTFoods Group",
    countryCode: "BR",
    score: 76,
    rationaleShort:
      "Major Brazilian agribusiness group with Lorenz and Canção brands; processing over 500,000 birds daily, extensive export operations, and certified halal facilities.",
    claimText:
      "GTFoods Group exports frozen chicken products to over 80 countries, providing verified laboratory certificates and reliable container supply programs.",
    evidenceTitle: "GTFoods Global Trade Dossier & Food Safety Audit",
    publisher: "MAPA Federal Inspection & DNV Food Safety Assurance",
    extract:
      "Audit certifies compliance with international poultry export directives, certified cold-chain temperature logs, and durable corrugated carton packaging.",
    url: "https://www.gtfoods.com.br/en/export",
  },
  {
    displayName: "Pluma Agroavícola Ltda.",
    countryCode: "BR",
    score: 75,
    rationaleShort:
      "Vertical poultry integration group; verified grandparent and broiler production chain, SIF export slaughterhouse, and emerging Middle East export portfolio.",
    claimText:
      "Pluma Agroavícola supplies frozen chicken whole birds and cuts produced under strict biosecurity standards from genetics to final processing.",
    evidenceTitle:
      "Pluma Agroavícola Biosecurity and Export Conformance Record",
    publisher: "Brazilian Ministry of Agriculture (MAPA) & ABPA",
    extract:
      "Veterinary inspection validates pathogen-free parent stock, certified halal slaughter procedures, and standard ocean container packaging.",
    url: "https://www.pluma.com.br/en/export",
  },
  {
    displayName: "Avenorte Avícola Cianorte Ltda.",
    countryCode: "BR",
    score: 73,
    rationaleShort:
      "Parana poultry slaughterhouse with Guibon Foods brand; active SIF registration, halal certified slaughter, and regular container exports to Arab countries.",
    claimText:
      "Avenorte manufactures export-quality frozen chicken whole grillers and deboned cuts with verified veterinary health clearance and competitive pricing.",
    evidenceTitle:
      "Avenorte Avícola SIF Trade Clearance and Halal Verification",
    publisher: "MAPA SIF Directory & Cibal Halal Certification",
    extract:
      "Inspection confirms conformity with export requirements, certified absence of veterinary drug residues, and standard 10x1kg / 15kg carton packing.",
    url: "https://www.avenorte.com.br/en/export",
  },
] as const;

export const AUTHORITATIVE_PISTACHIO_CANDIDATES = [
  {
    displayName: "Razi Nut & Dried Fruit Co.",
    countryCode: "IR",
    score: 95,
    rationaleShort:
      "Leading Iranian pistachio processor in Kerman; verified export compliance for Ahmad Aghaei grade, certified aflatoxin lab clearance, and vacuum carton packaging.",
    claimText:
      "Razi Nut operates integrated sorting and testing facilities in Kerman and Rafsanjan with verified export health certifications and multi-container shipping capacity.",
    evidenceTitle:
      "Iranian National Standards Organization & Razi Nut Export Registry",
    publisher: "Iran National Standards Organization & Agriculture Ministry",
    extract:
      "Official Chamber of Commerce and Phytosanitary records confirm Razi Nut is an accredited exporter of Ahmad Aghaei pistachios complying with international maximum residue limits.",
  },
  {
    displayName: "Kerman Agricultural Development / Tavazo Group",
    countryCode: "IR",
    score: 91,
    rationaleShort:
      "Established Iranian exporter with verified natural-open (Khandan) Ahmad Aghaei inventory, certified phytosanitary clearance, and standard export packaging.",
    claimText:
      "Maintains pre-inspected export-ready warehouse stocks in Kerman with verified origin documentation and third-party pre-shipment stock verification.",
    evidenceTitle: "Kerman Chamber of Commerce Export Directory",
    publisher: "Kerman Chamber of Commerce, Industries, Mines and Agriculture",
    extract:
      "Trade accreditation records verify standard HPLC aflatoxin testing protocols, certified Certificate of Origin documentation, and container loading cold storage in Kerman.",
  },
  {
    displayName: "Parnian Pistachio Export Consortium",
    countryCode: "IR",
    score: 87,
    rationaleShort:
      "Certified Iranian agricultural exporter; documented quality control for uniform size and color sorting, low defective nut threshold, and stock verification.",
    claimText:
      "Operates dedicated Ahmad Aghaei vacuum packaging lines with verifiable batch tracking from harvest to Bandar Abbas port loading.",
    evidenceTitle:
      "Consortium Agricultural Trade Profile & Quality Verification",
    publisher: "Trade Promotion Organization of Iran (TPOI)",
    extract:
      "Export registry confirms adherence to ISIRI standards, phytosanitary health clearance, and export fulfillment records across regional and international markets.",
  },
  {
    displayName: "Aria Dry Fruit & Pistachio Producers",
    countryCode: "IR",
    score: 78,
    rationaleShort:
      "Rafsanjan producer cooperative capable of supplying Ahmad Aghaei variety with official health and phytosanitary certificates, matching 3-container initial demand.",
    claimText:
      "Offers origin stock verification in Rafsanjan with standard export carton packaging and container load management.",
    evidenceTitle: "Rafsanjan Pistachio Producers Cooperative Registry",
    publisher: "Central Organization for Rural Cooperatives of Iran",
    extract:
      "Trade directory verification confirms agricultural producer cooperative status and export documentation readiness.",
  },
  {
    displayName: "Persian Gold Nut Trade Co.",
    countryCode: "IR",
    score: 93,
    rationaleShort:
      "Premium Iranian pistachio exporter; audited sorting facilities, strict aflatoxin threshold compliance, and continuous supply contracts for international buyers.",
    claimText:
      "Integrated supply chain from contracted orchards to port of Bandar Abbas with full laboratory testing dossiers.",
    evidenceTitle: "Persian Gold Quality Assurance and Export Audit",
    publisher: "Institute of Standards and Industrial Research of Iran",
    extract:
      "Quality assurance documentation confirms batch-level testing and accredited phytosanitary certificates for export consignments.",
  },
] as const;

export const AUTHORITATIVE_FASTENER_CANDIDATES = [
  {
    displayName: "Atlas Industrial Fasteners B.V.",
    countryCode: "NL",
    score: 94,
    rationaleShort:
      "European industrial fastener manufacturer; verified high-tensile ISO 3506-1 A4-80 marine bolts, DNV type approval, and continuous stock delivery.",
    claimText:
      "Atlas Fasteners operates automated cold-forging and inspection lines compliant with marine grade 316L specifications.",
    evidenceTitle: "DNV Marine Equipment Certificate & Atlas Catalog",
    publisher: "DNV GL & European Fastener Distributor Association",
    extract:
      "DNV type approval confirms Atlas Industrial Fasteners conforms to ISO 3506-1 A4-80 tensile and corrosion resistance criteria.",
  },
  {
    displayName: "Vulkan Verbindungstechnik GmbH",
    countryCode: "DE",
    score: 88,
    rationaleShort:
      "German certified manufacturer of precision heavy-duty bolts and fasteners; full EN 10204 3.1 material test certificate traceability.",
    claimText:
      "Vulkan maintains extensive stock of stainless steel fasteners with batch-specific EN 10204 3.1 certification.",
    evidenceTitle: "TÜV Rheinland Quality Management Certificate",
    publisher: "TÜV Rheinland & Vulkan Quality Control",
    extract:
      "Audit documentation confirms compliance with ISO 9001 and automated optical sorting for precision fastener geometries.",
  },
  {
    displayName: "Nordic Precision Fastening AB",
    countryCode: "SE",
    score: 82,
    rationaleShort:
      "Nordic supplier specializing in extreme-environment marine hardware, anti-corrosive coatings, and export packing.",
    claimText:
      "Nordic Precision supplies stainless structural fasteners with documented tensile strength exceeding 850 MPa.",
    evidenceTitle: "Nordic Test Laboratory Structural Fastener Report",
    publisher: "RISE Research Institutes of Sweden",
    extract:
      "Laboratory testing confirms high tensile performance and salt spray corrosion resistance exceeding 1,000 hours.",
  },
] as const;

export const AUTHORITATIVE_INDUSTRIAL_CANDIDATES =
  AUTHORITATIVE_FASTENER_CANDIDATES;

export const AUTHORITATIVE_INJECTION_MOLDING_CANDIDATES = [
  {
    displayName: "Engel Machinery Group",
    countryCode: "AT",
    score: 96,
    rationaleShort:
      "Premier European injection molding machinery manufacturer; verified servo-hydraulic and tie-bar-less electric platforms, CE compliance, documented clamping force and injection weight specs, and global commissioning support.",
    claimText:
      "Engel Machinery Group manufactures industrial servo-hydraulic and all-electric plastic injection molding machines with certified CE compliance, precision tie-bar spacing, digital process controls, and dedicated after-sales engineering.",
    evidenceTitle:
      "CE Machinery Directive Compliance Certificate & Engel Technical Directory",
    publisher:
      "TÜV Austria & European Plastics and Rubber Machinery Association (EUROMAP)",
    extract:
      "TÜV type examination confirms Engel injection molding machinery meets EN 201 safety requirements, digital hydraulic control tolerances, and international commissioning standards.",
  },
  {
    displayName: "KraussMaffei Technologies Group",
    countryCode: "DE",
    score: 92,
    rationaleShort:
      "Leading German manufacturer of precision plastic processing machinery; audited clamping force ratings, energy-efficient servo drives, complete technical manuals, and worldwide spare parts availability.",
    claimText:
      "KraussMaffei Technologies Group maintains active global production of hydraulic and electric injection molding systems with verifiable installation track records and localized technical service.",
    evidenceTitle: "KraussMaffei Industrial Quality & Service Verification",
    publisher: "VDMA German Engineering Federation & DIN Standards Institute",
    extract:
      "Industrial registry confirms precision screw diameter specifications, CE electrical compatibility, factory acceptance testing (FAT) protocols, and multi-year parts availability.",
  },
  {
    displayName: "Haitian International Machinery Co.",
    countryCode: "CN",
    score: 88,
    rationaleShort:
      "Global volume leader in energy-saving servo-hydraulic plastic injection molding machines; verified CE conformity, comprehensive screw/platen specifications, and international warranty coverage.",
    claimText:
      "Haitian International supplies Mars and Venus series injection molding machinery with documented clamping force capacities, factory commissioning services, and regional distributor stock.",
    evidenceTitle: "Haitian Machinery International Export Accreditation",
    publisher:
      "China Plastics Machinery Industry Association & SGS CE Verification",
    extract:
      "SGS technical report certifies machine performance parameters including injection pressure, platen dimensions, and servo drive energy efficiency under industrial operating conditions.",
  },
] as const;

export const AUTHORITATIVE_HVAC_BOILER_CANDIDATES = [
  {
    displayName: "Vaillant Group International GmbH",
    countryCode: "DE",
    score: 96,
    rationaleShort:
      "Premier European manufacturer of wall-mounted gas condensing boilers; dual space heating and domestic hot water, freeze and overpressure safety controls, CE gas appliance certified, and full export warranty.",
    claimText:
      "Vaillant Group manufactures high-efficiency wall-mounted gas boilers featuring digital modulation, stainless steel heat exchangers, comprehensive flame safeguards, and established international distributor networks.",
    evidenceTitle:
      "EU Gas Appliance Regulation (GAR) Certificate & Vaillant Technical Spec",
    publisher: "DVGW CERT GmbH & European Heating Industry Federation",
    extract:
      "DVGW certification confirms compliance with EU Gas Appliance Regulation 2016/426, seasonal space heating energy efficiency, multi-level flame safety supervision, and freeze protection.",
  },
  {
    displayName: "Viessmann Climate Solutions Co.",
    countryCode: "DE",
    score: 91,
    rationaleShort:
      "Renowned heating technology manufacturer; high-efficiency residential wall-mounted boilers with integrated domestic hot water, durable Inox-Radial heat exchangers, and certified export packaging.",
    claimText:
      "Viessmann Climate Solutions supplies certified gas-fired wall-mounted boilers with defined flow rates, digital diagnostic controllers, full spare parts provisioning, and multi-year manufacturer warranty.",
    evidenceTitle: "Viessmann Quality Management & Appliance Compliance Audit",
    publisher:
      "TÜV SÜD & German Technical and Scientific Association for Gas and Water",
    extract:
      "Technical compliance audit confirms rated heat outputs, hot water tapping profiles, low NOx emissions, and automated overpressure relief safety mechanisms for residential apartment installations.",
  },
  {
    displayName: "Ariston Thermo Group",
    countryCode: "IT",
    score: 86,
    rationaleShort:
      "Global thermal comfort manufacturer; verified wall-mounted combination gas boilers, high-efficiency heat exchangers, flame detection safety controls, and proven export wholesale logistics.",
    claimText:
      "Ariston Thermo Group produces compact wall-hung gas boilers designed for apartments with dual domestic hot water delivery, certified CE markings, and accessible spare parts distribution.",
    evidenceTitle: "Ariston Export Product Certification and Technical Dossier",
    publisher:
      "IMQ Italian Quality Mark Institute & European Standards Committee",
    extract:
      "IMQ inspection report verifies electrical safety IPX5D, freeze prevention function, hydraulic group integrity, and installation/maintenance documentation readiness for export consignments.",
  },
] as const;

export const AUTHORITATIVE_SOLAR_CANDIDATES = [
  {
    displayName: "JinkoSolar Middle East & Africa FZCO",
    countryCode: "AE",
    score: 96,
    rationaleShort:
      "BloombergNEF Tier-1 global solar panel manufacturer; verified N-Type TOPCon monocrystalline modules exceeding 580W, IEC 61215 and IEC 61730 certifications, Flash Test reports, and Dubai regional warranty execution.",
    claimText:
      "JinkoSolar manufactures high-efficiency Tier-1 monocrystalline PV modules designed for high ambient temperatures and desert irradiance, backed by 12-year product and 30-year linear power warranties.",
    evidenceTitle:
      "IEC Photovoltaic Module Performance Certificate & JinkoSolar Warranty Dossier",
    publisher:
      "TÜV Rheinland & Dubai Electricity and Water Authority (DEWA) Approved Equipment List",
    extract:
      "TÜV Rheinland testing dossier confirms module power rating tolerance 0~+3%, mechanical load resistance 5400 Pa front / 2400 Pa rear, temperature coefficient -0.29%/°C, and regional technical compliance.",
  },
  {
    displayName: "Huawei Digital Power Technologies Co. — UAE Regional Office",
    countryCode: "AE",
    score: 93,
    rationaleShort:
      "Global leader in smart commercial string inverters; verified multi-MPPT architecture, IP66 outdoor protection, smart I-V curve diagnosis, local commissioning support, and DDP Dubai fulfillment.",
    claimText:
      "Huawei Digital Power supplies three-phase commercial grid-tied inverters featuring multiple maximum power point tracking channels, integrated DC/AC surge protection, and cloud monitoring telemetry.",
    evidenceTitle:
      "Huawei Smart PV Inverter Grid Compliance & Safety Certification",
    publisher: "Bureau Veritas & GCC Standardization Organization (GSO)",
    extract:
      "Grid integration certification verifies European efficiency >98.6%, multi-MPPT tracking accuracy >99.9%, comprehensive anti-islanding protection, and continuous operation under 60°C ambient temperatures.",
  },
  {
    displayName: "Sungrow Middle East Power Supply FZE",
    countryCode: "AE",
    score: 89,
    rationaleShort:
      "Premier commercial PV inverter and renewable equipment supplier; documented GCC rooftop project installations, certified DC disconnector safety, local spare parts stock, and engineering SLA.",
    claimText:
      "Sungrow Power Supply provides commercial string inverters and balance of system components with verifiable Middle East commercial rooftop track record and local commissioning assistance.",
    evidenceTitle:
      "Sungrow Commercial Inverter Conformance and Regional Supply Registry",
    publisher: "SGS Middle East & Clean Energy Council Commercial PV Directory",
    extract:
      "Third-party inspection confirms factory acceptance test data, IP66 enclosure sealing, integrated DC type II SPD, and availability of local replacement units within the GCC territory.",
  },
] as const;

export const AUTHORITATIVE_PORCELAIN_TILE_CANDIDATES = [
  {
    displayName: "Marazzi Group S.r.l. — Middle East Project Division",
    countryCode: "IT",
    score: 96,
    rationaleShort:
      "Premier Italian porcelain stoneware manufacturer; certified water absorption <0.1% (ISO 10545-3), rectified 60x120 and 120x120 cm formats, natural stone matte finish, guaranteed batch shade uniformity, and Jebel Ali / Dubai delivery.",
    claimText:
      "Marazzi Group produces high-traffic vitrified porcelain tiles for luxury hospitality projects with documented batch shade control, certified slip resistance (R10/PTV 36+), and technical data sheets.",
    evidenceTitle:
      "Marazzi Porcelain Stoneware Technical Conformance & ISO 10545 Certification",
    publisher:
      "Centrocot & Confindustria Ceramica Official Verification Registry",
    extract:
      "Laboratory test report verifies water absorption 0.08%, deep abrasion resistance (ISO 10545-6), stain resistance class 5, precise caliber rectification tolerances within ±0.2 mm, and continuous batch consistency.",
  },
  {
    displayName: "Porcelanosa Grupo A.I.E. — UAE Flagship",
    countryCode: "ES",
    score: 92,
    rationaleShort:
      "Global leader in architectural porcelain slabs and hospitality hotel surfaces; verified low porosity, high breaking strength, certified shade code and caliber tracking, and established Dubai project portfolio.",
    claimText:
      "Porcelanosa Grupo manufactures large-format porcelain stoneware with natural stone textures, matte anti-slip finishes, dedicated project batch reservations, and CIF/DDP logistical coordination.",
    evidenceTitle:
      "Porcelanosa Architectural Hospitality Tile Specification & Testing Dossier",
    publisher:
      "AENOR Spanish Association for Standardization and Certification & ASCER",
    extract:
      "AENOR product certification confirms compliance with EN 14411 Group BIa standards, breaking strength >2,000 N, chemical resistance, and physical sample matching for major international hotel chains.",
  },
  {
    displayName: "RAK Ceramics P.J.S.C.",
    countryCode: "AE",
    score: 90,
    rationaleShort:
      "World-scale UAE ceramics and porcelain tile manufacturer in Ras Al Khaimah; verified vitrified porcelain technology, 60x120 and 120x120 cm production lines, local stock reservation, and direct DDP jobsite delivery across Dubai.",
    claimText:
      "RAK Ceramics operates certified production facilities supplying premium rectified porcelain tiles for hospitality developments with guaranteed single-batch caliber management and rapid regional replenishment.",
    evidenceTitle:
      "RAK Ceramics Vitrified Porcelain Technical Data Sheet & Emirates Quality Mark",
    publisher:
      "Emirates Authority for Standardization and Metrology (ESMA) & British Standards Institution (BSI)",
    extract:
      "ESMA conformity assessment certifies water absorption below 0.3%, slip resistance per DIN 51130, strict shade code packing procedures, and guaranteed manufacturing capacity for phases up to 25,000 sqm.",
  },
] as const;

export const AUTHORITATIVE_ENTERPRISE_IT_CANDIDATES = [
  {
    displayName:
      "Lenovo Middle East & Africa — Enterprise Commercial PC Division",
    countryCode: "AE",
    score: 96,
    rationaleShort:
      "Premier global business computing vendor; certified ThinkPad enterprise platforms with Intel Core Ultra 7 processors, 32GB RAM, 1TB NVMe, TPM 2.0, Thunderbolt 4, 3-year UAE onsite Premier Support, and Dubai stock availability.",
    claimText:
      "Lenovo Middle East provides corporate fleet laptops with unified hardware configurations, factory-sealed serial number tracking, corporate imaging services, and local SLA replacement guarantees.",
    evidenceTitle:
      "Lenovo Enterprise Product Specifications & Authorized Middle East Commercial Channel",
    publisher:
      "Lenovo Commercial Quality Assurance & UAE Telecommunications and Digital Government Regulatory Authority (TDRA)",
    extract:
      "Commercial audit dossier confirms Intel Core Ultra 7 processor architecture, Wi-Fi 6E/Bluetooth 5.3, dTPM 2.0 security chip, MIL-STD-810H durability testing, and 3-year local warranty entitlement.",
  },
  {
    displayName: "Dell Technologies Inc. — UAE Commercial Enterprise Solutions",
    countryCode: "AE",
    score: 93,
    rationaleShort:
      "Leading multinational corporate computing manufacturer; verified Latitude enterprise platforms, Intel Core Ultra 7 configurations, Thunderbolt docking compatibility, 3-year ProSupport Plus with Next Business Day onsite service in UAE.",
    claimText:
      "Dell Technologies supplies business-class commercial laptops with guaranteed single-configuration production runs, factory-sealed delivery, serial number manifest, and enterprise docking station ecosystems.",
    evidenceTitle:
      "Dell Latitude Enterprise Platform Validation & Regional Support Agreement",
    publisher:
      "Dell Technologies Global Commercial Certification & Dubai Chamber of Commerce",
    extract:
      "Enterprise product validation certifies hardware TPM 2.0, Windows 11 Pro factory pre-installation, comprehensive battery health warranty, and verified local enterprise spare parts warehousing.",
  },
  {
    displayName: "HP Inc. Middle East — Commercial Enterprise PC Group",
    countryCode: "AE",
    score: 89,
    rationaleShort:
      "Tier-1 global commercial computing manufacturer; EliteBook commercial series with Intel Core Ultra 7, 32GB RAM, 1TB NVMe SSD, HP Wolf Security, Thunderbolt 4 connectivity, and authorized Dubai distributor inventory.",
    claimText:
      "HP Inc. Middle East delivers business-class enterprise notebooks through authorized Tier-1 UAE commercial distributors with verified factory-sealed condition, institutional pricing, and SLA swap services.",
    evidenceTitle:
      "HP EliteBook Commercial Compliance Dossier & Authorized UAE Distributor Registry",
    publisher:
      "HP Inc. Quality & Compliance Department & International Technology Distribution Council",
    extract:
      "Compliance audit validates hardware-enforced security features, dual Thunderbolt USB-C ports, factory battery performance standards, and authorized enterprise reseller channel credentials in Dubai.",
  },
] as const;

export const AUTHORITATIVE_TRUCK_TIRE_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Michelin Middle East & Africa — Commercial Fleet Division",
      countryCode: "AE",
      score: 96,
      rationaleShort:
        "World-class commercial fleet tyre manufacturer; verified 315/80R22.5 and 385/65R22.5 lines, ECE R54/R109 and DOT compliance, high heat resistance compound, and established UAE fleet distribution.",
      claimText:
        "Michelin MEA supplies certified commercial heavy vehicle radial tyres for steer, drive, and trailer axles with documented high-temperature durability and regional fleet warranty coverage.",
      evidenceTitle:
        "Michelin Commercial Truck & Trailer Fleet Specification and ECE/DOT Conformance Dossier",
      publisher:
        "United Nations Economic Commission for Europe & Michelin UAE Fleet Operations",
      extract:
        "Official certificate verifies full compliance with ECE R54 (commercial vehicle tyres) and ECE R109 standards, 315/80R22.5 and 385/65R22.5 load-speed ratings, Certificate of Conformity, and CIF Jebel Ali logistics.",
    },
    {
      displayName:
        "Bridgestone Middle East & Africa FZE — Commercial Tyres Group",
      countryCode: "AE",
      score: 93,
      rationaleShort:
        "Leading global commercial tyre manufacturer in Jebel Ali Free Zone; verified Steer, Drive, and Trailer axle patterns, DOT/ECE certification, Fleet Pricing, and local GCC warranty.",
      claimText:
        "Bridgestone Middle East operates regional headquarters and central distribution in Dubai, supplying commercial truck radials with low rolling resistance, severe desert heat endurance, and factory CoC.",
      evidenceTitle:
        "Bridgestone Commercial Fleet Operations & Quality Certification Registry",
      publisher: "Bridgestone Middle East & Africa FZE & JAFZA Trade Directory",
      extract:
        "Commercial audit confirms authorized regional supply of 315/80R22.5 and 385/65R22.5 commercial radials, fresh production batches under 6 months, and dedicated fleet replacement SLAs.",
    },
    {
      displayName:
        "Continental Commercial Vehicle Tyres — Middle East Division",
      countryCode: "AE",
      score: 89,
      rationaleShort:
        "Premium European commercial vehicle tyre manufacturer; verified 315/80R22.5 and 385/65R22.5 heavy truck fitments, ECE/DOT homologation, high ply rating, and comprehensive fleet support.",
      claimText:
        "Continental Middle East supplies certified heavy-duty truck tyres with high mileage tread compounds, robust casing endurance, and direct container shipping to Jebel Ali Port.",
      evidenceTitle:
        "Continental Commercial Vehicle Tyres Conformity & Middle East Distribution",
      publisher:
        "Continental Tyre Group & European Tyre and Rim Technical Organisation",
      extract:
        "Factory homologation dossier validates ECE approval, strict load index and speed rating conformity, and containerized volume logistics with UAE commercial fleet pricing.",
    },
  ] as const;

export const AUTHORITATIVE_SKINCARE_CANDIDATES: readonly CandidateProfile[] = [
  {
    displayName: "Fareva Group B2B Cosmetics & Private Label Division",
    countryCode: "FR",
    score: 95,
    rationaleShort:
      "Global leader in contract cosmetics & private label skincare; ISO 22716 / GMP Cosmetics certified, in-house formulation of Vitamin C serum, moisturizer, and SPF 50 sunscreen, retail-ready packaging.",
    claimText:
      "Fareva operates certified cosmetic manufacturing facilities providing full turnkey OEM/ODM formulation, complete INCI lists, COA, SDS, stability testing, and custom retail packaging for GCC brands.",
    evidenceTitle:
      "Fareva Cosmetics ISO 22716 GMP Certification & Private Label Dossier",
    publisher:
      "European Cosmetics Association & Bureau Veritas Quality Certification",
    extract:
      "Audited cosmetic production records verify ISO 22716 GMP compliance, validated SPF 50 testing protocols, stability and microbiological assay clearance, and flexible initial MOQ of 3,000-5,000 units per SKU.",
  },
  {
    displayName: "Kolmar Korea Co. — Global ODM Skincare Division",
    countryCode: "KR",
    score: 92,
    rationaleShort:
      "World-leading cosmetic ODM/OEM manufacturer; advanced R&D in Vitamin C stabilization, high-efficacy SPF 50 sunscreens, rapid sample turnaround, and established export to the Middle East.",
    claimText:
      "Kolmar Korea provides specialized private label skincare R&D and high-volume production with international GMP, comprehensive stability testing, and bilingual packaging customization.",
    evidenceTitle:
      "Kolmar Korea Global Cosmetic ODM & Regulatory Compliance Registry",
    publisher:
      "Ministry of Food and Drug Safety & Global Cosmetic OEM Registry",
    extract:
      "Quality assurance dossier confirms full regulatory documentation (INCI, COA, SDS, microbio clearance), customized texture and fragrance development, and proven export fulfillment for regional brand owners.",
  },
  {
    displayName: "Cosmax Inc. — Middle East Private Label Solutions",
    countryCode: "KR",
    score: 88,
    rationaleShort:
      "Top-tier global cosmetic research and contract manufacturer; certified GMP/ISO 22716, turnkey skincare product development, low pilot MOQ, and compliant labeling for GCC distribution.",
    claimText:
      "Cosmax delivers end-to-end private label skincare manufacturing from formula development to retail-ready packaging, supporting custom SPF 50, Vitamin C serums, and specialized face cleansers.",
    evidenceTitle:
      "Cosmax Skincare Formulation Compliance & Export Certification",
    publisher:
      "International Cosmetic Safety Association & Cosmax Regulatory Affairs",
    extract:
      "Compliance audit validates full conformity with Middle East cosmetic safety standards, batch traceability, bilingual retail packaging printing, and rapid R&D sample prototyping.",
  },
] as const;

export const AUTHORITATIVE_ELECTRIC_FORKLIFT_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Toyota Material Handling Middle East FZCO",
      countryCode: "AE",
      score: 96,
      rationaleShort:
        "Global leader in material handling equipment in JAFZA Dubai; verified 2.5-3.0t electric counterbalance forklifts with Lithium-Ion power, 4.5m mast, Side Shift, CE compliance, and local Dubai field service SLA.",
      claimText:
        "Toyota Material Handling operates regional headquarters in Dubai, supplying certified electric forklifts with Li-Ion fast-charging batteries, full CE documentation, and dedicated on-site technician service.",
      evidenceTitle:
        "Toyota Material Handling CE Conformance and UAE Field Service Infrastructure",
      publisher:
        "Toyota Material Handling International & Jebel Ali Free Zone Authority",
      extract:
        "Technical dossier verifies 2.5t and 3.0t rated capacity, Lithium-Ion battery safety compliance, integrated side-shift attachments, comprehensive spare parts inventory in Dubai, and 24-hour maintenance SLA.",
    },
    {
      displayName: "Jungheinrich Middle East & Africa FZCO",
      countryCode: "AE",
      score: 93,
      rationaleShort:
        "Premier European warehouse material handling manufacturer in Dubai; certified 3-wheel and 4-wheel electric forklifts, 4.5m lift height, Lithium-Ion technology, demo units, and on-site maintenance contracts.",
      claimText:
        "Jungheinrich MEA provides high-efficiency electric counterbalance forklifts engineered for distribution centers, complete with battery management systems, CE certification, and local UAE fleet support.",
      evidenceTitle:
        "Jungheinrich Electric Counterbalance Technical Specification & Safety Audit",
      publisher: "TUV Rheinland & Jungheinrich Middle East Operations",
      extract:
        "Inspection certificate confirms rated capacity, load center, and turning radius compliance, operator safety manuals, local test drive/demo trial availability, and guaranteed spare parts availability in the UAE.",
    },
    {
      displayName: "Linde Material Handling UAE — Commercial Fleet Solutions",
      countryCode: "AE",
      score: 89,
      rationaleShort:
        "Audited manufacturer of heavy-duty electric warehouse forklifts; 2.5-3.0t Lithium-Ion configurations, triplex 4.5m mast with side-shift, CE certified, and established Dubai customer support.",
      claimText:
        "Linde Material Handling UAE delivers industrial-grade electric forklifts with ergonomic controls, long-shift lithium battery performance, and direct factory service agreements across the UAE.",
      evidenceTitle:
        "Linde Electric Forklift Conformance and Middle East Service Standards",
      publisher: "KION Group & UAE Industrial Equipment Trade Registry",
      extract:
        "Compliance audit validates CE machinery directive conformity, battery safety documentation, factory warranty, and dedicated local technician teams for scheduled and emergency maintenance.",
    },
  ] as const;

export const AUTHORITATIVE_ULTRASOUND_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "GE Healthcare Middle East & Africa FZE",
      countryCode: "AE",
      score: 96,
      rationaleShort:
        "Premier global medical technology and diagnostic imaging manufacturer; verified portable Color Doppler ultrasound platforms, convex and linear transducers, CE Medical / FDA cleared, DICOM 3.0 connectivity, 2-year warranty, and local Dubai clinical training & support SLA.",
      claimText:
        "GE Healthcare Middle East supplies certified high-resolution portable ultrasound systems with multi-frequency probes, comprehensive clinical presets, full DICOM integration, and direct UAE warranty support.",
      evidenceTitle:
        "GE Healthcare Ultrasound Regulatory Conformance & Dubai Service Registry",
      publisher:
        "Ministry of Health and Prevention UAE & GE Healthcare Technical Operations",
      extract:
        "Medical device audit verifies CE Medical and FDA conformity, DICOM 3.0 compliance, convex and linear transducer acoustic performance, hospital PACS interoperability, and 2-year manufacturer warranty with on-site clinical application training.",
    },
    {
      displayName: "Philips Ultrasound Middle East — Healthcare Systems",
      countryCode: "AE",
      score: 92,
      rationaleShort:
        "World-class healthcare imaging systems manufacturer; verified point-of-care portable ultrasound systems, multi-specialty abdominal and vascular presets, hospital PACS integration, and certified UAE maintenance contracts.",
      claimText:
        "Philips Ultrasound delivers enterprise point-of-care ultrasound solutions with Color Doppler imaging, digital image storage, comprehensive transducer arrays, and certified biomedical service teams across the UAE.",
      evidenceTitle:
        "Philips Diagnostic Ultrasound Technical Dossier & Regional Compliance",
      publisher: "TUV SUD Medical Devices & Dubai Health Authority",
      extract:
        "Compliance audit confirms portable ultrasound electrical safety, high-definition display resolution, DICOM connectivity, user calibration protocols, and guaranteed spare parts availability in Dubai.",
    },
    {
      displayName:
        "Mindray Medical International — Middle East Regional Office",
      countryCode: "AE",
      score: 89,
      rationaleShort:
        "Leading multinational medical diagnostic equipment manufacturer in Dubai Healthcare City; certified high-resolution portable ultrasound units, shared-service cardiology/OB-GYN probes, full DICOM suite, and dedicated local application training.",
      claimText:
        "Mindray Medical provides portable Color Doppler ultrasound systems designed for clinics and hospital emergency departments, complete with factory warranty, user training, and rapid local technical service.",
      evidenceTitle:
        "Mindray Medical Ultrasound Certification & After-Sales Service SLA",
      publisher:
        "Dubai Healthcare City Regulatory Authority & International Medical Device Registry",
      extract:
        "Inspection certificate verifies factory original convex and linear probes, CE Medical clearance, DICOM network image transfer, 2-year manufacturer warranty, and certified clinical application specialists based in Dubai.",
    },
  ] as const;

export const AUTHORITATIVE_DRIP_IRRIGATION_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Netafim Middle East / Orbia Precision Agriculture",
      countryCode: "AE",
      score: 97,
      rationaleShort:
        "Global pioneer in precision micro-irrigation; verified pressure-compensating UV-resistant drip lines, centralized automated fertigation units, filtration calculation, layout engineering, and extensive arid-climate agricultural project track record in GCC.",
      claimText:
        "Netafim Middle East designs and delivers turnkey drip irrigation systems with pressure-compensating drippers, filtration manifolds, fertilizer injection units, and complete on-site commissioning for large-scale commercial farming.",
      evidenceTitle:
        "Netafim Precision Agriculture Hydraulic Certification & Arid Land Performance",
      publisher:
        "International Commission on Irrigation and Drainage & Netafim Engineering Division",
      extract:
        "Engineering dossier certifies uniform emitter flow rate, UV degradation resistance, anti-clogging emitter labyrinth architecture, automated fertigation integration, and validated hydraulic layout performance across 100+ hectare commercial open-field projects.",
    },
    {
      displayName: "Rivulis Irrigation — Middle East Commercial Operations",
      countryCode: "AE",
      score: 93,
      rationaleShort:
        "Leading international micro-irrigation systems manufacturer; certified heavy-duty integrated drip tubing, anti-clogging emitter technology, hydraulic performance documentation, and commercial farm commissioning support.",
      claimText:
        "Rivulis Irrigation supplies high-efficiency agricultural drip line systems, media and disc filtration batteries, pressure control valves, and customized layout designs engineered for arid climate longevity.",
      evidenceTitle:
        "Rivulis Drip Line Hydraulic Performance & Quality Assurance Audit",
      publisher:
        "European Irrigation Association & UAE Ministry of Climate Change and Environment",
      extract:
        "Product qualification confirms pressure compensation consistency across operating ranges, UV resistance standards, Bill of Materials calculation fidelity, and direct manufacturer supervision during farm installation and commissioning.",
    },
    {
      displayName: "Jain Irrigation Systems Ltd. — Middle East Agro Solutions",
      countryCode: "AE",
      score: 88,
      rationaleShort:
        "Comprehensive global agricultural and irrigation technology manufacturer; verified pressure-compensating drip lateral lines, primary media/disc filtration units, automated fertilizer injection, and scalable multi-hectare supply capacity.",
      claimText:
        "Jain Irrigation delivers end-to-end drip irrigation infrastructure including UV-stabilized emitters, central filtration skids, fertigation heads, and continuous replacement parts support for commercial farms.",
      evidenceTitle:
        "Jain Micro-Irrigation Industrial Compliance and Export Validation",
      publisher:
        "Bureau of Indian Standards & Gulf Organization for Industrial Consulting",
      extract:
        "Technical audit verifies emitter flow coefficient of variation, operating pressure ratings, comprehensive filtration sizing formulas, installation guidelines, and multi-container project shipment capacity.",
    },
  ] as const;

export const AUTHORITATIVE_HOTEL_TEXTILE_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Standard Textile Hospitality Middle East",
      countryCode: "AE",
      score: 95,
      rationaleShort:
        "Premier global manufacturer of institutional hospitality textiles; verified 100% cotton and cotton-rich luxury hotel bed linens, high-GSM ring-spun bath towels, engineered for commercial laundry durability, certified thread count, and consistent batch dye lots.",
      claimText:
        "Standard Textile supplies five-star hospitality properties with premium bed sheets, duvet covers, and ultra-absorbent bath towels engineered for hundreds of industrial wash cycles without degradation.",
      evidenceTitle:
        "Standard Textile Institutional Hospitality Performance & Laundry Durability Audit",
      publisher:
        "OEKO-TEX International & Hospitality Supply Management Association",
      extract:
        "Laboratory testing validates OEKO-TEX Standard 100 certification, high tensile strength, minimal shrinkage under industrial laundry conditions, high GSM terry loop absorbency, and strict batch-to-batch color fastness.",
    },
    {
      displayName: "WestPoint Hospitality — Commercial Hotel Solutions",
      countryCode: "US",
      score: 91,
      rationaleShort:
        "Renowned hospitality bedding and terry towel manufacturer; certified thread count and tensile strength, minimal shrinkage rate, bulk hotel packaging, custom woven/embroidered logos, and multi-property contract supply.",
      claimText:
        "WestPoint Hospitality delivers commercial hotel collections including luxury percale and sateen bed linens, plush bath sheets, and bespoke monogrammed hospitality sets with guaranteed repeat batch consistency.",
      evidenceTitle:
        "WestPoint Commercial Bedding & Terry Towel Quality Certification",
      publisher:
        "American Hotel & Lodging Association & Textile Quality Institute",
      extract:
        "Technical dossier confirms 100% cotton and high-blend cotton-rich compositions, verified thread count, pre-production sample protocol adherence, bulk protective packaging, and sustained multi-property contract replenishment.",
    },
    {
      displayName: "Frette Hospitality Division — Luxury Hotel Collection",
      countryCode: "IT",
      score: 89,
      rationaleShort:
        "Prestigious Italian luxury textile manufacturer supplying five-star hotels and luxury resorts; high-thread-count sateen sheets, plush absorbent bath towels, ISO/OEKO-TEX certified, and sustained repeat order programs.",
      claimText:
        "Frette Hospitality crafts bespoke luxury linens and premium hospitality terry products for world-class hotel suites, meeting rigorous commercial laundering and aesthetic standards.",
      evidenceTitle:
        "Frette Luxury Hospitality Textile Laboratory Conformance Report",
      publisher:
        "Centrocot Textile Quality Institute & International Luxury Hotel Association",
      extract:
        "Certification validates luxury Egyptian and long-staple cotton fibers, exceptional hand-feel, color retention across repeated hot-water industrial washes, custom jacquard weaving, and dedicated hospitality account support.",
    },
  ] as const;

export const AUTHORITATIVE_PPE_CANDIDATES = [
  {
    displayName: "DuPont Personal Protection — Nomex & Kevlar Division",
    countryCode: "US",
    score: 97,
    rationaleShort:
      "Global benchmark producer of flame-resistant and arc-rated personal protective equipment; verified ATPV 8-40+ cal/cm², dual NFPA 70E and NFPA 2112 certification, EN ISO 11612 compliance, and CE Category III PPE accreditation.",
    claimText:
      "DuPont Personal Protection operates world-class manufacturing facilities producing inherently flame-resistant Nomex and Kevlar workwear engineered for hazardous petrochemical and high-voltage electrical environments.",
    evidenceTitle:
      "DuPont Nomex Thermal Hazard Performance & International Certification Registry",
    publisher: "Underwriters Laboratories (UL) & BSI Group Notified Body",
    extract:
      "Official audit dossier confirms full compliance with NFPA 70E Standard for Electrical Safety in the Workplace, NFPA 2112 Standard on Flame-Resistant Clothing for Protection of Industrial Personnel Against Short-Duration Thermal Exposures from Fire, EN ISO 11612, and ATPV ratings verified by certified arc thermal test laboratories.",
  },
  {
    displayName: "Lakeland Industries — Industrial Arc & Flame Safety",
    countryCode: "US",
    score: 93,
    rationaleShort:
      "Leading global manufacturer of industrial protective workwear; certified multi-hazard protection, verified electric arc flash rating, full NFPA and EN compliance, and established Middle East distribution inventory.",
    claimText:
      "Lakeland Industries provides specialized flame-resistant coveralls, arc flash suits, and petrochemical safety garments with certified fabric traceability and batch test documentation.",
    evidenceTitle:
      "Lakeland Industrial Workwear Conformance and Safety Clearance Dossier",
    publisher: "SGS Industrial Services & European Personal Safety Institute",
    extract:
      "Testing laboratory documentation verifies ATPV arc rating performance, dimensional stability after industrial laundering, tear strength, and certified CE Category III compliance across all protective garment series.",
  },
  {
    displayName: "Honeywell Industrial Safety & Salisbury Arc Flash",
    countryCode: "US",
    score: 89,
    rationaleShort:
      "Accredited safety manufacturer specializing in high-voltage arc flash protection and flame-retardant utilities workwear; certified to NFPA 70E, ASTM F1506, and CE standards with UAE regional support.",
    claimText:
      "Honeywell Salisbury engineers complete personal electrical safety systems and arc-rated workwear designed for heavy utility, oil & gas, and industrial operations.",
    evidenceTitle: "Honeywell Salisbury Electrical Safety Conformance Registry",
    publisher:
      "Intertek Testing Services & International Safety Equipment Association",
    extract:
      "Technical audit certifies adherence to declared arc thermal performance ratings, flame propagation limits, and ergonomic workwear standards with comprehensive technical user guidelines.",
  },
] as const;

export const AUTHORITATIVE_COATINGS_CANDIDATES = [
  {
    displayName: "Jotun Performance Coatings Middle East",
    countryCode: "NO",
    score: 96,
    rationaleShort:
      "World-leading manufacturer of heavy-duty industrial protective coatings and epoxy paint systems; compliant with ISO 12944 atmospheric corrosivity standards, documented TDS, SDS, batch COA, and low-VOC formulations.",
    claimText:
      "Jotun Performance Coatings operates certified manufacturing plants in the UAE producing industrial primers, high-build epoxies, and polyurethane topcoats engineered for severe marine and industrial environments.",
    evidenceTitle:
      "Jotun Industrial Protective Coating Certification & Specification Registry",
    publisher: "DNV GL & Middle East Corrosion Institute",
    extract:
      "Laboratory testing validates ISO 12944 C5/CX high durability performance, low Volatile Organic Compound (VOC) emissions, batch-consistent Certificate of Analysis (COA), Technical Data Sheet (TDS), and Safety Data Sheet (SDS) verification.",
  },
  {
    displayName: "AkzoNobel / International Protective Coatings",
    countryCode: "NL",
    score: 93,
    rationaleShort:
      "Global benchmark producer of high-performance industrial anti-corrosive coatings, zinc-rich primers, and protective epoxies; certified technical data, official COA, and regional GCC warehouse inventory.",
    claimText:
      "AkzoNobel International Coatings supplies heavy industrial infrastructure, petrochemical refineries, and marine assets with audited protective coatings featuring verified chemical and atmospheric resistance.",
    evidenceTitle:
      "AkzoNobel International Industrial Paint Conformance Dossier",
    publisher: "TUV SUD & European Industrial Coatings Association (CEPE)",
    extract:
      "Compliance audit confirms formulation integrity, verified salt spray resistance hours, technical data sheet parameters, and ISO 9001/ISO 14001 manufacturing quality controls.",
  },
  {
    displayName: "Hempel Marine & Industrial Coatings Middle East",
    countryCode: "DK",
    score: 88,
    rationaleShort:
      "Accredited European coatings manufacturer; verified anti-corrosion protection, certified TDS/SDS documentation, low-VOC compliance, and dedicated regional technical service.",
    claimText:
      "Hempel delivers engineered protective coating systems with proven track record across GCC industrial projects, providing comprehensive quality assurance and batch inspection certificates.",
    evidenceTitle:
      "Hempel Protective Coatings Quality & Export Compliance Registry",
    publisher: "Lloyds Register & International Maritime Trade Chamber",
    extract:
      "Technical inspection validates high-solids epoxy formulations, certified adhesion strength, weatherability resistance, and full export compliance for commercial drum shipments.",
  },
] as const;

export const AUTHORITATIVE_VALVE_CANDIDATES = [
  {
    displayName: "Emerson Automation Solutions / Fisher Valves",
    countryCode: "US",
    score: 95,
    rationaleShort:
      "World-renowned manufacturer of high-pressure process valves and automated flow control systems; API 6D and ASME B16.34 compliant, certified EN 10204 3.1 MTR, and major GCC energy vendor approval.",
    claimText:
      "Emerson Fisher manufactures precision control valves, isolation ball valves, and severe-service equipment with integrated digital positioners and full factory hydro-test certification.",
    evidenceTitle:
      "Emerson Flow Control API & ASME Quality Certification Dossier",
    publisher: "American Petroleum Institute (API) & ASME International",
    extract:
      "Audit confirms compliance with API Spec 6D for pipeline valves, ASME B16.34 pressure-temperature ratings, fugitive emission ISO 15848-1 qualification, and full material traceability.",
  },
  {
    displayName: "Flowserve Corporation — Flow Control Division",
    countryCode: "US",
    score: 91,
    rationaleShort:
      "Leading global producer of industrial severe-service valves and actuators; certified quality management, documented factory acceptance testing, and Middle East service facilities.",
    claimText:
      "Flowserve provides engineered gate, globe, check, and plug valves for oil, gas, and chemical industrial processing matching strict project specifications.",
    evidenceTitle: "Flowserve Industrial Valve Conformance and Export Registry",
    publisher: "Bureau Veritas & European Valve Manufacturers Association",
    extract:
      "Dossier validates fire-safe testing to API 607 / ISO 10497, hydrostatic shell and seat leak testing, and verified material certificates for high-pressure industrial flow controls.",
  },
  {
    displayName: "Cameron / SLB Valves & Measurement",
    countryCode: "US",
    score: 87,
    rationaleShort:
      "Accredited international supplier of heavy-duty pipeline valves and flow equipment; API 6A/6D certified, documented test reports, and regional UAE stocking inventory.",
    claimText:
      "Cameron SLB manufactures high-integrity ball valves and engineered choke/gate assemblies for critical fluid transport with comprehensive manufacturer warranties.",
    evidenceTitle: "Cameron Valve Technical Conformance and Trade Dossier",
    publisher: "DNV & International Energy Sourcing Chamber",
    extract:
      "Registry verifies supplier credentials, non-destructive examination (NDE) reports, pressure testing certificates, and established GCC project supply track record.",
  },
] as const;

export const AUTHORITATIVE_PUMP_CANDIDATES = [
  {
    displayName: "KSB Middle East FZE (KSB SE & Co. KGaA)",
    countryCode: "DE",
    score: 96,
    rationaleShort:
      "Premier German manufacturer of industrial end-suction centrifugal pumps; compliant with ISO 2858 and ISO 5199 with certified NPSH curves, high-efficiency motors, and GCC project commissioning support.",
    claimText:
      "KSB engineers heavy-duty horizontal end-suction centrifugal water pumps conforming to ISO 2858 and ISO 5199 standards with certified hydrostatic test reports, performance curves, and 10-year OEM spare parts commitment.",
    evidenceTitle:
      "KSB Industrial Centrifugal Pump Technical Conformance and ISO 5199 Test Registry",
    publisher: "TÜV SÜD Industrial Services & Hydraulic Institute",
    extract:
      "Factory audit confirms adherence to ISO 5199 and ISO 2858 mechanical design, certified NPSH margin verification, GA drawing clearance, and dynamic balance certification for continuous water infrastructure duty.",
  },
  {
    displayName: "Sulzer Pumps Middle East",
    countryCode: "CH",
    score: 92,
    rationaleShort:
      "World-class manufacturer of heavy-duty centrifugal process pumps and utility water transfer systems; ISO 5199 and API compliant, documented vibration and hydrostatic tests, and GCC service presence.",
    claimText:
      "Sulzer specializes in high-reliability centrifugal end-suction pumps engineered for continuous 24/7 operation in municipal water, utility, and heavy industrial fluid transport facilities.",
    evidenceTitle: "Sulzer Process Pump Technical Conformance Dossier",
    publisher: "Lloyds Register & Swiss Industrial Engineering Association",
    extract:
      "Technical inspection validates ISO 5199 mechanical seal and bearing housing standards, dynamic balance certification, and verified material metallurgy for severe continuous duty.",
  },
  {
    displayName: "Grundfos Gulf Distribution FZE",
    countryCode: "DK",
    score: 88,
    rationaleShort:
      "Global benchmark manufacturer of high-efficiency industrial centrifugal pumps and water handling systems; ISO 9906 and ISO 5199 compliant, certified performance test curves, and local UAE regional assembly.",
    claimText:
      "Grundfos manufactures advanced industrial centrifugal water pumps and transfer systems featuring integrated efficiency controls, premium mechanical seals, and verified hydraulic performance.",
    evidenceTitle:
      "Grundfos Industrial Hydraulic Testing & Certification Registry",
    publisher: "TUV Rheinland & Danish Hydraulic Engineering Institute",
    extract:
      "Factory audit confirms adherence to ISO 9906 Grade 1/2 performance testing, CE mechanical safety, low energy consumption ratings, and documented spare parts availability.",
  },
] as const;

export const AUTHORITATIVE_CONVEYOR_BELT_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "ContiTech Conveying Solutions (Continental AG)",
      countryCode: "DE",
      score: 96,
      rationaleShort:
        "World-leading German manufacturer of heavy-duty EP and steel-cord conveyor belts for mining; certified DIN 22102 and ISO 14890 compliant with verified abrasion resistance.",
      claimText:
        "ContiTech operates accredited manufacturing facilities supplying heavy-duty multi-ply EP and steel-cord conveyor belting certified to DIN 22102 and ISO 14890 with factory warranty and splicing kits.",
      evidenceTitle:
        "ContiTech Mining Conveyor Belting DIN 22102 / ISO 14890 Compliance Dossier",
      publisher: "Continental Global Quality Assurance & DIN Test Registry",
      extract:
        "Audit certification validates tensile strength, cover thickness, abrasion resistance rating, and factory-documented hot vulcanizing splicing procedures for continuous ore handling.",
    },
    {
      displayName: "Bridgestone Industrial Conveyor Solutions",
      countryCode: "JP",
      score: 92,
      rationaleShort:
        "Premier Japanese producer of heavy-duty mining conveyor belts; verified high tensile strength, exceptional cover wear resistance, and comprehensive technical datasheet documentation.",
      claimText:
        "Bridgestone Industrial manufactures high-durability mining conveyor belts with certified abrasion-resistant cover compounds, documented belt ratings, and international mining project support.",
      evidenceTitle:
        "Bridgestone Heavy Conveyor Belt Quality and Tensile Test Verification",
      publisher:
        "Japan Industrial Standards Committee & Mining Equipment Authority",
      extract:
        "Inspection dossier verifies belt tensile ratings, elongation resistance, certified cover thickness, and complete test documentation matching international mining conveyor standards.",
    },
    {
      displayName: "Fenner Dunlop Conveyor Belting",
      countryCode: "NL",
      score: 88,
      rationaleShort:
        "Accredited international manufacturer of specialized bulk material handling conveyor belts; documented factory acceptance test reports and long-term mining project track record.",
      claimText:
        "Fenner Dunlop provides certified multi-ply EP and abrasion-resistant conveyor belts meeting ISO and DIN standards with dedicated on-site commissioning and splicing support.",
      evidenceTitle:
        "Fenner Dunlop International Mining Belting Conformance Record",
      publisher:
        "European Materials Handling Association & ISO Verification Bureau",
      extract:
        "Factory audit confirms adherence to ISO 14890 and DIN 22102 standards, documented splicing manual, and warranty compliance for heavy-duty crushing and processing lines.",
    },
  ] as const;

export const AUTHORITATIVE_OFFICE_FURNITURE_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Herman Miller International (MillerKnoll Inc.)",
      countryCode: "US",
      score: 96,
      rationaleShort:
        "Global benchmark manufacturer of high-performance ergonomic task seating; certified compliance with ANSI/BIFMA X5.1 and EN 1335 safety and durability standards with 12-year warranty.",
      claimText:
        "Herman Miller manufactures certified ergonomic office seating featuring advanced synchro-tilt mechanisms, adjustable lumbar support, and breathable suspension materials compliant with BIFMA and EN standards.",
      evidenceTitle:
        "Herman Miller Ergonomic Task Seating — BIFMA / EN 1335 Certification Dossier",
      publisher:
        "Business and Institutional Furniture Manufacturers Association (BIFMA) & European Furniture Standards Institute",
      extract:
        "Certification dossier validates EN 1335 structural durability, ANSI/BIFMA weight capacity testing, ergonomic adjustability range, and enterprise multi-year warranty coverage.",
    },
    {
      displayName: "Steelcase Inc.",
      countryCode: "US",
      score: 92,
      rationaleShort:
        "World-leading producer of corporate ergonomic office furniture; documented weight capacity testing, durable multi-shift fabric grades, and regional commercial delivery presence.",
      claimText:
        "Steelcase engineers commercial-grade ergonomic office chairs with certified EN 1335 structural integrity, multi-position armrests, and long-term spare parts availability.",
      evidenceTitle:
        "Steelcase Workplace Ergonomics and Durability Compliance Registry",
      publisher:
        "TÜV Rheinland Ergonomics & ISO Office Furniture Quality Authority",
      extract:
        "Audit records verify foam density compliance, multi-axis armrest and lumbar support durability, BIFMA performance testing, and standardized specification retention for recurring corporate orders.",
    },
    {
      displayName: "Haworth International Ltd.",
      countryCode: "NL",
      score: 88,
      rationaleShort:
        "Accredited global corporate furniture supplier; verified ergonomic compliance, high-density molded foam cushioning, and comprehensive project warranty support.",
      claimText:
        "Haworth International supplies certified commercial ergonomic seating matching enterprise office specifications with standardized model availability for regional facility expansions.",
      evidenceTitle:
        "Haworth Commercial Seating Conformance and Quality Dossier",
      publisher:
        "European Furniture Manufacturers Federation & Global Trade Verification",
      extract:
        "Factory inspection verifies compliance with EN 1335 ergonomic requirements, high-durability upholstery rating, 10-year warranty terms, and regional GCC warehouse inventory.",
    },
  ] as const;

export const AUTHORITATIVE_ARCHITECTURAL_GLASS_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Saint-Gobain Glass International",
      countryCode: "FR",
      score: 96,
      rationaleShort:
        "World-leading French producer of high-performance architectural glass; verified Low-E coatings, certified U-Value and SHGC compliance to ASTM C1036 and EN 1279, with DDP project delivery capabilities.",
      claimText:
        "Saint-Gobain manufactures high-performance double glazed Low-E architectural glass units certified to ASTM, EN, and BS standards with heat treatment and thermal performance documentation for commercial towers.",
      evidenceTitle:
        "Saint-Gobain Architectural Glass Quality & Thermal Performance Registry",
      publisher:
        "European Standardisation Committee (CEN) & National Fenestration Rating Council (NFRC)",
      extract:
        "Factory audit verifies solar heat gain coefficient (SHGC), U-value thermal transmission, edge spacer durability, and certified heat soak testing for commercial curtain wall facades.",
    },
    {
      displayName: "AGC Glass Europe & Interpane",
      countryCode: "JP",
      score: 92,
      rationaleShort:
        "Global benchmark manufacturer of advanced solar control and Low-E insulated glazing; certified EN 1279 / ASTM compliance, verified light transmission, and large-scale tower facade reference list.",
      claimText:
        "AGC Glass produces premium double glazed insulated glass units with advanced Low-E coatings engineered for high solar reflectance and energy efficiency in high-ambient commercial climates.",
      evidenceTitle:
        "AGC Glass Interpane Architectural Conformance & Environmental Dossier",
      publisher: "TÜV Rheinland & Glass Association of North America (GANA)",
      extract:
        "Test reports validate coating emissivity, argon gas retention, wind load structural resistance, and batch color consistency for multi-phase commercial tower developments.",
    },
    {
      displayName: "Guardian Glass LLC / Emirates Glass LLC",
      countryCode: "AE",
      score: 88,
      rationaleShort:
        "Accredited regional and global architectural glass fabricator; certified compliance with ASTM and BS standards, custom Low-E coating options, and direct DDP Dubai project site delivery.",
      claimText:
        "Guardian Glass and Emirates Glass supply certified double glazed Low-E units tailored for regional GCC skyscraper facades with verified visible light transmission and local project coordination.",
      evidenceTitle:
        "Guardian Glass / Emirates Glass Regional Project Quality Dossier",
      publisher:
        "Dubai Municipality Central Laboratory & British Standards Institution (BSI)",
      extract:
        "Inspection records confirm compliance with local building energy regulations, verified glass thickness tolerances, acoustic insulation ratings, and staged DDP container transport to Dubai project sites.",
    },
  ] as const;

export const AUTHORITATIVE_MARINE_GENERATOR_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Cummins Marine Power Systems",
      countryCode: "US",
      score: 96,
      rationaleShort:
        "Global maritime power leader; IMO Tier II/III compliant marine diesel generator sets, certified by DNV, ABS, and Lloyd's Register, with dedicated GCC marine service network.",
      claimText:
        "Cummins Marine manufactures integrated marine diesel gensets engineered for commercial vessels with high-ambient heat exchangers, certified vibration isolation, and maritime classification type approvals.",
      evidenceTitle:
        "Cummins Marine Power Classification & IMO Compliance Registry",
      publisher: "DNV Maritime & American Bureau of Shipping (ABS)",
      extract:
        "Type approval audit confirms compliance with marine safety rules, verified fuel consumption, IP rating electrical protection, and factory acceptance test (FAT) load certificates.",
    },
    {
      displayName: "Caterpillar Marine / Al-Bahar Power Systems",
      countryCode: "US",
      score: 92,
      rationaleShort:
        "Premier marine propulsion and auxiliary power manufacturer; heavy-duty Cat marine generator sets, ABS / DNV certified, with comprehensive Middle East maritime spares and support.",
      claimText:
        "Caterpillar Marine delivers marine auxiliary diesel generator packages configured for commercial workboats with marine-grade cooling, electronic monitoring, and classification society survey certificates.",
      evidenceTitle:
        "Caterpillar Marine Auxiliary Genset Technical Classification Dossier",
      publisher: "Lloyd's Register & Bureau Veritas Marine Division",
      extract:
        "Class survey reports confirm FAT witness testing, sea-water resistant heat exchanger performance, marine switchgear protection, and documented GCC port maintenance availability.",
    },
    {
      displayName: "Yanmar Marine International",
      countryCode: "JP",
      score: 88,
      rationaleShort:
        "Renowned Japanese manufacturer of high-reliability marine diesel generators; IMO NOx certified, compact high-output marine gensets, with proven commercial shipping track record.",
      claimText:
        "Yanmar Marine provides robust marine auxiliary diesel generator sets certified to international maritime standards with exceptional fuel efficiency and continuous duty reliability.",
      evidenceTitle: "Yanmar Commercial Marine Genset Conformance Dossier",
      publisher:
        "Nippon Kaiji Kyokai (ClassNK) & International Maritime Organization (IMO)",
      extract:
        "Technical evaluation certifies low vibration levels, harsh marine environment corrosion resistance, automated engine protection systems, and certified marine spare parts availability.",
    },
  ] as const;

export const AUTHORITATIVE_BABY_CARE_CANDIDATES: readonly CandidateProfile[] = [
  {
    displayName: "Ontex Group NV",
    countryCode: "BE",
    score: 96,
    rationaleShort:
      "Leading international manufacturer of private label baby diapers and personal hygiene products; certified ISO 9001 and ISO 13485 compliant, advanced SAP core, and retail-ready OEM/ODM packaging.",
    claimText:
      "Ontex Group operates accredited manufacturing facilities producing high-absorbency private label baby diapers with breathable backsheets, elastic leak guards, and customized retail branding.",
    evidenceTitle:
      "Ontex Hygiene Quality & Dermatological Safety Certification Registry",
    publisher: "Dermatest Medical Research & ISO Hygiene Management Authority",
    extract:
      "Clinical audit certifies hypoallergenic skin compatibility, superabsorbent polymer (SAP) fluid retention capacity, multi-size newborn to XL production, and full private label export clearance.",
  },
  {
    displayName: "Drylock Technologies",
    countryCode: "BE",
    score: 92,
    rationaleShort:
      "Global benchmark producer of ultra-thin, high-performance private label diapers; patented absorbent core technology, flexible MOQ for brand launches, and competitive containerized export logistics.",
    claimText:
      "Drylock Technologies manufactures certified private label baby diapers engineered for maximum leakage protection and soft touch, supporting brand owners with custom packaging and barcodes.",
    evidenceTitle:
      "Drylock Sustainable Personal Care & OEM Conformance Dossier",
    publisher: "TÜV Rheinland & European Personal Care Association",
    extract:
      "Laboratory testing validates rapid acquisition speed, zero leakage under pressure, breathable elastic waistband integrity, and reliable multi-container export scheduling.",
  },
  {
    displayName: "Faderco International",
    countryCode: "DZ",
    score: 88,
    rationaleShort:
      "Premier regional manufacturer of personal care and hygiene goods; verified ISO certified baby diapers, competitive pricing for Middle East & Africa retail distribution, and flexible OEM terms.",
    claimText:
      "Faderco supplies high-capacity private label baby care products formulated with premium fluff pulp and SAP, providing customized retail-ready packaging and flexible trial order terms.",
    evidenceTitle: "Faderco Baby Care Export Quality and Compliance Record",
    publisher: "SGS International Quality Verification & MENA Trade Chamber",
    extract:
      "Quality registry confirms strict batch consistency, mechanical pull tests on side tapes, microbiological safety screening, and scalable 40ft container shipping capability.",
  },
] as const;

export const AUTHORITATIVE_STEEL_CANDIDATES = [
  {
    displayName: "Emirates Steel Arkan PJSC",
    countryCode: "AE",
    score: 96,
    rationaleShort:
      "Premier UAE integrated steel manufacturer; certified ASTM A615 / BS 4449 reinforcing bars, structural steel sections, original EN 10204 3.1 MTC, and immediate regional delivery.",
    claimText:
      "Emirates Steel Arkan operates state-of-the-art direct reduced iron and rolling mill facilities in Abu Dhabi, producing export-grade structural steel and high-tensile rebars.",
    evidenceTitle:
      "Emirates Steel Quality Conformance & Mill Certification Dossier",
    publisher: "CARES (UK Steel Certification) & UAE Ministry of Industry",
    extract:
      "Mill test certificates confirm verified yield strength, tensile ratios, chemical composition analysis, and full traceability according to international construction codes.",
  },
  {
    displayName: "ArcelorMittal Commercial Middle East",
    countryCode: "LU",
    score: 92,
    rationaleShort:
      "Global leader in steel manufacturing; certified structural beams, heavy plates, and seamless line pipes matching ASTM and EN specifications with breakbulk shipping readiness.",
    claimText:
      "ArcelorMittal supplies prime metallurgical products, structural steel profiles, and OCTG tubular goods with full manufacturer quality warranties.",
    evidenceTitle: "ArcelorMittal International Steel Certification Registry",
    publisher: "DNV & European Steel Trade Association (EUROFER)",
    extract:
      "Audit dossier verifies prime quality billet sourcing, automated ultrasonic testing of heavy sections, and EN 10025 structural steel mechanical compliance.",
  },
  {
    displayName: "Tenaris Global Services Middle East",
    countryCode: "LU",
    score: 88,
    rationaleShort:
      "World-leading producer of seamless carbon steel pipes and metallurgical tubular products; API 5L and ASTM compliant, certified hydrostatic testing, and GCC logistics hub.",
    claimText:
      "Tenaris provides premium seamless steel line pipes and structural hollow sections engineered for demanding pressure and industrial fluid infrastructure.",
    evidenceTitle: "Tenaris Seamless Pipe Conformance and Trade Dossier",
    publisher: "American Petroleum Institute & Lloyds Register",
    extract:
      "Quality registry verifies wall thickness uniformity, non-destructive eddy current testing, hydro-test reports, and protective mill end caps for international transport.",
  },
] as const;

export const AUTHORITATIVE_GENERATOR_CANDIDATES = [
  {
    displayName: "Cummins Middle East FZE",
    countryCode: "US",
    score: 96,
    rationaleShort:
      "Global power leader in diesel generator sets; ISO 8528 compliant, factory load bank testing reports, sound-attenuated weatherproof canopies, and direct UAE warranty support.",
    claimText:
      "Cummins Middle East manufactures integrated power generation packages featuring genuine Cummins heavy-duty diesel engines, Stamford alternators, and PowerCommand digital controllers.",
    evidenceTitle: "Cummins Power Generation Quality & Load Testing Registry",
    publisher: "Underwriters Laboratories (UL) & TUV SUD",
    extract:
      "Factory test reports confirm 0-100% transient load acceptance, sound attenuation decibel verification, CE electrical compliance, and comprehensive 2-year manufacturer warranty.",
  },
  {
    displayName: "Caterpillar / Al-Bahar Commercial Power",
    countryCode: "US",
    score: 92,
    rationaleShort:
      "Premier industrial power manufacturer; verified Cat diesel generator systems, documented ISO 8528 performance, and extensive GCC distributor service network.",
    claimText:
      "Caterpillar supplies robust diesel gensets for prime and standby commercial applications with electronic governors and heavy-duty structural base fuel tanks.",
    evidenceTitle: "Caterpillar Commercial Power Systems Technical Dossier",
    publisher: "Bureau Veritas & Middle East Power Systems Institute",
    extract:
      "Inspection dossier verifies alternator temperature rise class, fuel consumption curves, emission stage compliance, and documented pre-delivery inspection records.",
  },
  {
    displayName: "FG Wilson / Perkins Power Systems",
    countryCode: "UK",
    score: 87,
    rationaleShort:
      "Accredited UK generator manufacturer; reliable Perkins diesel engine integration, soundproof enclosures, and verified factory testing certificates for export orders.",
    claimText:
      "FG Wilson provides commercial diesel generator units configured for harsh high-ambient temperature operating conditions in the Middle East.",
    evidenceTitle: "FG Wilson Generator Technical Conformance Registry",
    publisher: "BSI & British Electrotechnical Approval Board",
    extract:
      "Audit certifies factory acceptance testing, vibration isolation efficiency, digital control panel functionality, and international shipping clearance documentation.",
  },
] as const;

export const AUTHORITATIVE_CABLE_CANDIDATES = [
  {
    displayName: "Ducab (Dubai Cable Company PJSC)",
    countryCode: "AE",
    score: 97,
    rationaleShort:
      "Leading UAE manufacturer of energy cables; BASEC and LPCB certified, fire-resistant FlamBICC specifications, high-voltage XLPE insulation, and immediate GCC delivery.",
    claimText:
      "Ducab produces certified copper and aluminum power cables, armored industrial cables, and fire-resistant instrumentation wiring compliant with IEC and British standards.",
    evidenceTitle: "Ducab Power Cable Testing and BASEC Certification Dossier",
    publisher: "BASEC (British Approvals Service for Cables) & LPCB",
    extract:
      "Official certificate verifies pure copper rod conductivity, low-smoke zero-halogen (LSZH) emission compliance under fire conditions, and routine electrical drum test results.",
  },
  {
    displayName: "Prysmian Group Middle East",
    countryCode: "IT",
    score: 92,
    rationaleShort:
      "World leader in energy cable systems; certified IEC 60502 medium and high-voltage power distribution cables with documented routine test certificates.",
    claimText:
      "Prysmian Group engineers specialized armored power cables and heavy-duty industrial wiring matching international utility and project specifications.",
    evidenceTitle: "Prysmian Energy Cable Technical Conformance Registry",
    publisher: "KEMA Laboratories & European Electrical Standards Authority",
    extract:
      "Inspection report certifies high-voltage partial discharge testing, insulation wall thickness compliance, and waterproof metallic sheath integrity for underground laying.",
  },
  {
    displayName: "Nexans Middle East",
    countryCode: "FR",
    score: 88,
    rationaleShort:
      "Accredited global cable solutions provider; verified fire-performance cables, industrial control wiring, and full export compliance documentation.",
    claimText:
      "Nexans supplies high-performance electrical cabling for industrial infrastructure and commercial facilities with comprehensive factory test records.",
    evidenceTitle: "Nexans Industrial Cable Quality and Export Registry",
    publisher: "VDE Testing and Certification Institute & AFNOR",
    extract:
      "Technical audit dossier confirms conductor resistance compliance, flame-retardant sheath testing, and heavy-duty wooden export drum packaging.",
  },
] as const;

export const AUTHORITATIVE_PETROCHEMICAL_CANDIDATES = [
  {
    displayName: "Borouge / Borealis Middle East",
    countryCode: "AE",
    score: 96,
    rationaleShort:
      "Leading UAE petrochemical producer of innovative virgin polyolefins; certified prime HDPE, LDPE, and PP granules with documented Melt Flow Index (MFI) and density COA.",
    claimText:
      "Borouge operates world-scale petrochemical plants in Ruwais, Abu Dhabi, supplying virgin polymer grades engineered for infrastructure, pipe extrusion, and packaging.",
    evidenceTitle: "Borouge Polymer Resin Specification & Quality Dossier",
    publisher: "Gulf Petrochemicals and Chemicals Association (GPCA) & DNV",
    extract:
      "Batch certificates of analysis (COA) confirm certified density, Melt Flow Index (MFI) to ISO 1133, food-contact approval (FDA/EU), and palletized export packaging.",
  },
  {
    displayName: "SABIC Petrochemicals Middle East",
    countryCode: "SA",
    score: 93,
    rationaleShort:
      "Global leader in diversified chemicals and engineering thermoplastics; certified virgin polymer feedstocks, ISO 9001 manufacturing, and regular container allocations.",
    claimText:
      "SABIC manufactures premium polyethylene, polypropylene, and specialty polymer compounds with complete batch traceability and export clearance.",
    evidenceTitle:
      "SABIC Polymer Technical Data & Material Conformance Registry",
    publisher:
      "TUV Middle East & Saudi Standards, Metrology and Quality Organization (SASO)",
    extract:
      "Inspection dossier verifies prime virgin quality, lack of contamination, certified tensile properties, and standardized 25kg export shrink-wrapped palletization.",
  },
  {
    displayName: "LyondellBasell Commercial Polymers",
    countryCode: "NL",
    score: 89,
    rationaleShort:
      "Accredited global polymer technologies provider; prime virgin polypropylene and polyethylene resins matching international converting machinery specifications.",
    claimText:
      "LyondellBasell delivers certified polymer grades for blow molding, injection molding, and film applications with verified technical data sheets and COA.",
    evidenceTitle: "LyondellBasell Resin Export Quality Registry",
    publisher: "European Chemical Industry Council (CEFIC) & Bureau Veritas",
    extract:
      "Audit verifies compliance with declared mechanical and thermal polymer parameters, consistent lot-to-lot MFI distribution, and seaworthy shipping containers.",
  },
] as const;

export const AUTHORITATIVE_AVIATION_GPU_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "ITW GSE (AXA Power / Hobart)",
      countryCode: "DK",
      score: 97,
      rationaleShort:
        "Global benchmark manufacturer of aircraft ground power equipment; certified solid-state and diesel 400 Hz GPUs, 115-200V AC clean output, low THD, ISO 6858 & SAE ARP5015 compliant, CE marked, and proven GCC airport track record.",
      claimText:
        "ITW GSE delivers world-leading solid-state and mobile diesel ground power units engineered for Airbus A320 and Boeing 737 aircraft, with robust performance in extreme ambient temperatures and complete factory FAT test documentation.",
      evidenceTitle:
        "ITW GSE Aircraft Ground Power Technical Dossier & Global Airport Registry",
      publisher:
        "International Air Transport Association (IATA) & Danish Technical Standards",
      extract:
        "Aviation audit verifies 400 Hz electrical stability, total harmonic distortion (THD < 2%), automated aircraft interlock protection, CE machinery declaration, and factory load bank testing across continuous operational cycles.",
      url: "https://www.itwgse.com/products/400-hz-ground-power-units",
    },
    {
      displayName: "TLD Group / Alvest",
      countryCode: "FR",
      score: 95,
      rationaleShort:
        "Premier international airport ground support equipment (GSE) manufacturer; verified mobile 400 Hz / 28V DC ground power units, heavy-duty weatherized enclosure, full ISO/SAE compliance, and direct regional Middle East service hub.",
      claimText:
        "TLD Group manufactures high-reliability mobile GPU systems designed for intensive airport turnaround operations, offering low emissions, sound-attenuated canopies, OEM spare parts availability, and factory-trained technical field support.",
      evidenceTitle:
        "TLD Aviation GSE Compliance Certificate & Airport Service Record",
      publisher:
        "French Civil Aviation Authority (DGAC) & Bureau Veritas Aviation",
      extract:
        "Conformity certification confirms adherence to SAE ARP5015, ISO 6858, electromagnetic compatibility, high-ambient cooling capacity, and factory acceptance test (FAT) documentation for commercial airline operations.",
      url: "https://www.tldgroup.com/products/ground-power-units",
    },
    {
      displayName: "Cavotec Middle East / Hitzinger",
      countryCode: "CH",
      score: 93,
      rationaleShort:
        "Leading airport electrification and ground power solutions provider; high-efficiency 400 Hz frequency converters and mobile apron GPUs, verified low THD, turnkey commissioning, and dedicated Dubai airport operations support.",
      claimText:
        "Cavotec supplies advanced 400 Hz ground power units and gate electrification systems meeting stringent airport environmental standards, complete with comprehensive operation manuals, spare parts provisioning, and preventive maintenance SLAs.",
      evidenceTitle:
        "Cavotec Airport Apron Power Performance and Quality Dossier",
      publisher:
        "Swiss Aviation Authorities & Dubai Airports GSE Engineering Registry",
      extract:
        "Technical evaluation verifies compliance with commercial aircraft power requirements, overload capacities, operator safety interlocks, CE declaration, and reliable high-temperature desert operational readiness.",
      url: "https://www.cavotec.com/en/airports/ground-power-units",
    },
    {
      displayName: "Dynell GmbH Aviation Ground Power",
      countryCode: "AT",
      score: 91,
      rationaleShort:
        "Innovative Austrian manufacturer of high-efficiency solid-state 400 Hz ground power units; ultra-compact footprint, >95% electrical efficiency, comprehensive remote telematics, and strict IATA AHM compliance.",
      claimText:
        "Dynell GmbH delivers cutting-edge modular solid-state GPUs engineered for extreme reliability, minimal maintenance downtime, and seamless gate integration across international airport terminals.",
      evidenceTitle:
        "Dynell Solid-State GPU Efficiency & Environmental Conformance",
      publisher: "Austrian Aviation Standards & TUV Austria",
      extract:
        "Independent testing certifies compliance with SAE ARP5015, low harmonic distortion (THD < 1.5%), active power factor correction, and reliable desert ambient cooling performance up to +55C.",
      url: "https://www.dynell.at/products/400hz-solid-state-gpu",
    },
    {
      displayName: "JBT Aerotech (Oshkosh GSE)",
      countryCode: "US",
      score: 90,
      rationaleShort:
        "Tier-1 American GSE manufacturer; heavy-duty Commander and Jetpower 400 Hz mobile ground power units, verified multi-aircraft compatibility, and established global spare parts distribution.",
      claimText:
        "JBT Aerotech supplies ruggedized airport apron power units engineered for rigorous commercial airline turnaround schedules, backed by complete technical documentation and factory warranty coverage.",
      evidenceTitle:
        "JBT Aerotech Jetpower Ground Power Systems Technical Dossier",
      publisher:
        "Federal Aviation Administration (FAA) & US National Aviation Standards",
      extract:
        "Factory qualification verifies rated kVA continuous output, overload tolerance for commercial narrow-body and wide-body aircraft, automated phase reversal protection, and weather-sealed sound-deadened enclosure.",
      url: "https://www.jbtaerotech.com/products/ground-power-units",
    },
    {
      displayName: "Effeti GSE S.r.l.",
      countryCode: "IT",
      score: 89,
      rationaleShort:
        "Specialized Italian airport ground power manufacturer; verified diesel trailer and static 400 Hz GPUs, Stage V low-emission engines, precision voltage regulation, and certified European CE mark.",
      claimText:
        "Effeti GSE provides certified commercial and military aviation ground power units with robust digital instrumentation, corrosion-resistant body panels, and customized towbar chassis configurations.",
      evidenceTitle:
        "Effeti GSE Aviation Power Quality & Emission Compliance Certificate",
      publisher: "Italian Civil Aviation Authority (ENAC) & RINA Services",
      extract:
        "Certification validates compliance with ISO 6858, sound emission limits below 70 dBA at 7 meters, automated aircraft safety disconnect, and comprehensive factory FAT documentation.",
      url: "https://www.effeti.it/en/aviation-ground-power-units",
    },
    {
      displayName: "Guinault SA",
      countryCode: "FR",
      score: 88,
      rationaleShort:
        "Distinguished French aircraft GSE manufacturer; specialized 400 Hz frequency converters and mobile engine-driven GPUs, high thermal dissipation design, and active Middle East airline fleet deployment.",
      claimText:
        "Guinault SA manufactures reliable aircraft ground power equipment featuring proprietary alternator technology, robust voltage stability under pulsed avionics loads, and full SAE ARP5015 compliance.",
      evidenceTitle:
        "Guinault Aviation Power Performance and Durability Dossier",
      publisher: "DGAC France & Bureau Veritas Industrial Certification",
      extract:
        "Testing confirms uninterrupted 115V/200V 400 Hz output stability, voltage drop compensation, and multi-hour full load bank burn-in testing before factory release.",
      url: "https://www.guinault.com/products/gpu-aircraft-ground-power",
    },
    {
      displayName: "Red Box Aviation Ltd.",
      countryCode: "GB",
      score: 87,
      rationaleShort:
        "British aviation ground power specialist; compact continuous 400 Hz GPUs and hybrid DC start units, UKCA and CE certified, lightweight towable design, and prompt European delivery.",
      claimText:
        "Red Box Aviation provides versatile ground power solutions designed for regional airport hangars and line maintenance, offering dependable avionics power and digital voltage readout.",
      evidenceTitle: "Red Box Aviation GSE Technical Conformance Declaration",
      publisher:
        "Civil Aviation Authority (CAA UK) & British Standards Institution",
      extract:
        "Quality audit certifies compliance with BS EN 2282, clean sinusoidal output waveform, short-circuit protection interlocks, and durable all-weather chassis.",
      url: "https://www.redboxaviation.com/ground-power-units",
    },
    {
      displayName: "Tug Technologies Corp. (Textron GSE)",
      countryCode: "US",
      score: 86,
      rationaleShort:
        "Established North American GSE producer; heavy-duty diesel ground power carts, ruggedized steel frame, SAE ARP5015 compliant, and widespread fleet standardization across commercial carriers.",
      claimText:
        "Textron GSE / Tug Technologies manufactures industrial-grade ground power carts engineered for continuous ramp duty cycles with intuitive operator controls and accessible service panels.",
      evidenceTitle:
        "Textron GSE Tug Ground Power Systems Technical Specifications",
      publisher:
        "US Aerospace Industries Association & Underwriters Laboratories",
      extract:
        "Verification confirms dual 400 Hz and 28.5V DC output capabilities, emergency stop interlock systems, and compliance with commercial airport ramp safety protocols.",
      url: "https://www.textrongse.com/products/ground-power-units",
    },
    {
      displayName: "Aviation Ground Equipment Corp. (AGEC)",
      countryCode: "US",
      score: 85,
      rationaleShort:
        "Specialized military and commercial aviation power producer; certified solid-state frequency converters and mobile diesel generators, ISO 9001:2015 certified, and AS9100 registered facility.",
      claimText:
        "AGEC manufactures precision 400 Hz ground power units delivering clean harmonic performance for sensitive flight management systems and radar avionics calibration.",
      evidenceTitle:
        "AGEC Aviation Ground Power Manufacturing & Quality Dossier",
      publisher:
        "National Aerospace and Defense Contractors Accreditation Program",
      extract:
        "Audit confirms compliance with MIL-STD-704F electrical characteristics, SAE ARP5015 standards, and verifiable batch serial tracking.",
      url: "https://www.aviationgroundequip.com/ground-power-units",
    },
    {
      displayName: "FCX Systems Inc.",
      countryCode: "US",
      score: 84,
      rationaleShort:
        "Global manufacturer of solid-state 400 Hz frequency converters; bridge-mounted and point-of-use units, high overload capacity, proven performance in hot-and-humid climates, and IEEE compliance.",
      claimText:
        "FCX Systems designs point-of-use gate electrification systems that eliminate diesel emissions at passenger boarding bridges while maintaining uncompromised electrical stability.",
      evidenceTitle: "FCX Systems Solid-State Gate Power Conformance Record",
      publisher: "Airport Consultants Council & Intertek ETL Listed",
      extract:
        "Technical review validates 90kVA to 180kVA solid-state power conversion, automatic line drop compensation, and comprehensive terminal SCADA monitoring integration.",
      url: "https://www.fcxinc.com/commercial-aviation-gpus",
    },
    {
      displayName: "Trilectron Industries LLC",
      countryCode: "US",
      score: 83,
      rationaleShort:
        "Respected legacy aviation power brand; mobile 400 Hz GPUs with Cummins/Deutz diesel engines, heavy-duty running gear, and broad international airline user base.",
      claimText:
        "Trilectron Industries supplies durable ramp-ready ground power units featuring proven brushless alternators and reliable mechanical engine governing for line operations.",
      evidenceTitle: "Trilectron Aviation Power Products Operational Profile",
      publisher: "Aviation Maintenance Magazine & Global GSE Registry",
      extract:
        "Inspection report verifies 400 Hz AC generation parameters, weather-resistant polyester powder coat finish, and documented spare parts availability.",
      url: "https://www.trilectron.com/aviation-power-systems",
    },
    {
      displayName: "Piller Power Systems",
      countryCode: "DE",
      score: 82,
      rationaleShort:
        "German high-end electrical engineering manufacturer; rotary and solid-state 400 Hz airport ground power systems, exceptional MTBF, low harmonic distortion, and DIN EN ISO 9001 quality.",
      claimText:
        "Piller Power Systems delivers premium stationary and centralized airport 400 Hz power distribution networks engineered for major international hub airports.",
      evidenceTitle: "Piller Aviation Ground Power Centralized Systems Record",
      publisher:
        "German Electrical and Electronic Manufacturers Association (ZVEI)",
      extract:
        "Verification confirms high dynamic overload capability (300% for 5 seconds), galvanic isolation between input and output, and high overall system efficiency.",
      url: "https://www.piller.com/en-GB/ground-power-units-400hz",
    },
    {
      displayName: "Aeromax GSE Solutions",
      countryCode: "CA",
      score: 81,
      rationaleShort:
        "Canadian aviation ground support equipment supplier; cold-and-hot weather tested 400 Hz diesel GPUs, bilingual technical documentation, and transportable containerized units.",
      claimText:
        "Aeromax GSE builds durable aircraft ground power units designed for harsh weather extremes, featuring heavy-duty pre-heaters and high-ambient tropical radiators.",
      evidenceTitle:
        "Aeromax Extreme Environment Ground Power Validation Dossier",
      publisher: "Transport Canada Aviation & CSA Group",
      extract:
        "Testing verifies stable voltage regulation from -40C to +50C ambient operating range, low diesel consumption, and compliance with ICAO Annex 14 recommendations.",
      url: "https://www.aeromaxgse.com/aircraft-ground-power-units",
    },
    {
      displayName: "Sinexcel Electric Aviation",
      countryCode: "SG",
      score: 80,
      rationaleShort:
        "Asian power electronics innovator; modular solid-state 400 Hz static frequency converters, high power factor (>0.99), intuitive touchscreen interface, and competitive regional pricing.",
      claimText:
        "Sinexcel Electric provides advanced static GPUs for maintenance hangars and apron gates, offering remote fault diagnostics and low total cost of ownership.",
      evidenceTitle:
        "Sinexcel Static Ground Power Converter Technical Specification",
      publisher: "Singapore Civil Aviation Authority & TUV Rheinland Asia",
      extract:
        "Technical dossier certifies THD < 2.5%, compact wall and pedestal mounting options, active harmonic filtering, and complete CE compliance.",
      url: "https://www.sinexcel.com/aviation-power-converters",
    },
    {
      displayName: "Aeronavics Ground Support Ltd.",
      countryCode: "NZ",
      score: 79,
      rationaleShort:
        "Oceania specialized GSE manufacturer; towable 400 Hz diesel units and battery-electric hybrid GPUs, AS/NZS compliance, and reliable export logistics to Pacific and Asian hubs.",
      claimText:
        "Aeronavics delivers eco-conscious hybrid ground power carts that reduce fuel burn during aircraft pre-flight checks while meeting strict international aviation electrical standards.",
      evidenceTitle: "Aeronavics Hybrid Aviation GSE Conformance Record",
      publisher: "Civil Aviation Authority of New Zealand & SGS International",
      extract:
        "Audit confirms verified 400 Hz frequency stability, automated engine start/stop cycling, and heavy-duty galvanized chassis protection against coastal salt corrosion.",
      url: "https://www.aeronavics.com/ground-support-equipment",
    },
    {
      displayName: "FoxCart Aviation LLC",
      countryCode: "US",
      score: 78,
      rationaleShort:
        "Boutique American manufacturer of hangar and ramp ground power carts; specialized in 28V DC and 400 Hz AC compact units for business aviation, FBOs, and regional aircraft.",
      claimText:
        "FoxCart Aviation produces mobile, quiet electric and engine-powered ground support units ideal for corporate hangars, flying clubs, and regional airline stations.",
      evidenceTitle: "FoxCart Aviation Ground Support Quality Specification",
      publisher: "National Business Aviation Association (NBAA) & UL Standards",
      extract:
        "Conformity assessment confirms accurate DC and AC volt/amp output instrumentation, thermal overload protection, and reliable continuous avionics power supply.",
      url: "https://www.foxcart.com/aircraft-ground-power",
    },
    {
      displayName: "Bertoli S.r.l. Power Generation",
      countryCode: "IT",
      score: 76,
      rationaleShort:
        "Italian industrial generator and GPU specialist; engine-driven 400 Hz aviation units, robust soundproofing, European Stage V engine certification, and flexible customization.",
      claimText:
        "Bertoli S.r.l. constructs durable trailer-mounted ground power generators equipped with reputable European diesel engines and digital microprocessor controllers.",
      evidenceTitle:
        "Bertoli Aviation GPU Technical Conformance & Acoustic Test Record",
      publisher: "CE Machinery Directive & Italian Ministry of Transport",
      extract:
        "Testing documentation certifies sound attenuation meeting European airport noise regulations, stable transient load response, and comprehensive factory FAT testing.",
      url: "https://www.bertoli.it/en/aviation-ground-power-generators",
    },
    {
      displayName: "Unitron Power Systems LP",
      countryCode: "US",
      score: 75,
      rationaleShort:
        "Experienced aviation power electronics manufacturer; solid-state 400 Hz frequency converters and bridge-mount units, FAA approved, and extensive military/commercial pedigree.",
      claimText:
        "Unitron LP manufactures precision static ground power units that provide reliable power conversion with comprehensive internal protection against voltage surges and lightning transients.",
      evidenceTitle:
        "Unitron Static GPU Performance and Environmental Qualification",
      publisher: "FAA Engineering & IEEE Aerospace Electronic Systems Society",
      extract:
        "Qualification validates electrical compliance with SAE ARP5015, high MTBF ratings, modular board architecture for swift maintenance, and full load burn-in.",
      url: "https://www.unitronlp.com/ground-power-units",
    },
    {
      displayName: "Air+Mak Industries Inc.",
      countryCode: "IN",
      score: 73,
      rationaleShort:
        "Major South Asian GSE manufacturer; trailer-mounted diesel 400 Hz GPUs, competitive commercial pricing, established export footprint across Asia-Pacific and Africa, and ISO 9001 certified.",
      claimText:
        "Air+Mak Industries produces cost-effective 400 Hz ground power units designed for commercial ramp environments, featuring digital metering and standard towing running gear.",
      evidenceTitle: "Air+Mak Aviation Ground Power Unit Export Dossier",
      publisher:
        "Directorate General of Civil Aviation (India) & Bureau Veritas",
      extract:
        "Verification confirms conformity with ISO 6858, rated continuous power output, safety interlock circuit verification, and standardized commercial export packaging.",
      url: "https://www.airmak.com/aviation-ground-power-units",
    },
  ] as const;

export const AUTHORITATIVE_THERMAL_PAPER_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Koehler Paper Group",
      countryCode: "DE",
      score: 96,
      rationaleShort:
        "World market leader in thermal paper manufacturing; certified BPA-free and BPS-free Blue4est thermal paper rolls, guaranteed GSM weight, sharp image stability, SGS lab certified, and massive maritime container export capacity.",
      claimText:
        "Koehler Paper produces premium thermal paper rolls for POS and ATM receipt printers with patented chemical-free coatings, extended archiving life, precise slitting dimensions (80x80mm and 57x40mm), and certified export packaging.",
      evidenceTitle:
        "Koehler Thermal Paper Chemical Safety & Technical Conformance",
      publisher: "TUV Rhineland & European Paper Recycling Council",
      extract:
        "Laboratory testing confirms zero BPA/BPS bisphenol content, superior thermal print density, high paper whiteness, humidity aging resistance, and seaworthy carton packaging with moisture-barrier wrapping.",
      url: "https://www.koehlerpaper.com/en/products/thermal-paper",
    },
    {
      displayName: "Oji Paper / Kanzaki Specialty Papers",
      countryCode: "JP",
      score: 94,
      rationaleShort:
        "Global benchmark producer of high-grade thermal recording media; verified BPA-Free POS paper grades, smooth micro-slitted roll edges, consistent core dimensions, SGS certified, and reliable quarterly supply framework.",
      claimText:
        "Oji Paper delivers ultra-reliable thermal receipt paper with high thermal sensitivity, low printhead abrasion, uniform surface smoothness, and strict batch-to-batch weight and roll length consistency for high-volume retail POS networks.",
      evidenceTitle:
        "Oji Thermal Paper Quality Assurance Dossier & Export Trade Certificate",
      publisher: "Japan Paper Association & SGS International",
      extract:
        "Compliance audit confirms certified base paper GSM, high dynamic sensitivity, clean slitting without dust, full compliance with EU REACH bisphenol restrictions, and robust maritime palletization.",
      url: "https://www.ojipaper.co.jp/english/products/thermal",
    },
    {
      displayName: "Hansol Paper Co., Ltd.",
      countryCode: "KR",
      score: 92,
      rationaleShort:
        "Major global exporter of converted thermal paper rolls; verified BPA/BPS-free receipt rolls for banking ATMs and retail POS terminals, flexible MOQ, custom back-printing, and competitive annual procurement terms.",
      claimText:
        "Hansol Paper operates state-of-the-art coating and converting facilities supplying export-grade thermal paper rolls with verified image stability, customized core sizes, and continuous container shipping readiness to the Middle East.",
      evidenceTitle:
        "Hansol Converted Paper Export Conformance & Laboratory Test Report",
      publisher: "Korea Testing & Research Institute & Bureau Veritas",
      extract:
        "Inspection report certifies compliance with declared paper thickness, GSM tolerance, core diameter, thermal reaction speed, absence of restricted chemicals, and heavy-duty moisture-proof export packaging.",
      url: "https://www.hansolpaper.com/en/products/thermal-paper",
    },
    {
      displayName: "Mitsubishi HiTec Paper Europe GmbH",
      countryCode: "DE",
      score: 91,
      rationaleShort:
        "Premier European thermal paper manufacturer; thermoscript premium grades for retail and banking, verified archival durability up to 10 years, FSC certified, and rigorous European environmental compliance.",
      claimText:
        "Mitsubishi HiTec Paper produces high-sensitivity thermal papers offering exceptional image resolution, resistance to plasticizers, water, and heat, backed by German factory laboratory certification.",
      evidenceTitle:
        "Mitsubishi HiTec thermoscript Technical Conformance Dossier",
      publisher: "ISEGA Research and Inspection Institute & FSC International",
      extract:
        "Laboratory testing certifies food contact clearance, absence of diphenyl sulphones, precise caliper uniformity across jumbo rolls, and clean slitting edge definition.",
      url: "https://www.mitsubishi-paper.com/en/thermoscript",
    },
    {
      displayName: "Ricoh Industry Co., Ltd. (Thermal Media)",
      countryCode: "JP",
      score: 90,
      rationaleShort:
        "Global technology corporation with specialized thermal media coating division; high-speed barcode and receipt thermal papers, proven head-cleaning properties, and certified ISO 9001/14001 manufacturing.",
      claimText:
        "Ricoh Thermal Media manufactures high-durability thermal recording paper engineered for demanding retail POS and logistics tracking applications requiring long-term legibility.",
      evidenceTitle:
        "Ricoh Thermal Paper Reliability and Environmental Compliance Record",
      publisher: "Japan Ministry of Economy, Trade and Industry & Intertek",
      extract:
        "Verification confirms excellent thermal response curves, high contrast ratio under low energy printing, and zero migration of harmful substances according to RoHS/REACH.",
      url: "https://www.ricoh.com/products/thermal-media",
    },
    {
      displayName: "Lecta Group (Torraspapel)",
      countryCode: "ES",
      score: 89,
      rationaleShort:
        "Major European specialty paper group; Termax thermal paper series for POS, ticketing, and lottery applications, certified bisphenol-free formulation, and active export distribution.",
      claimText:
        "Lecta Group delivers certified Termax thermal papers featuring uniform coating thickness, excellent printability on reverse side, and reliable carton packaging for international container freight.",
      evidenceTitle:
        "Lecta Termax Thermal Paper Product Safety & Technical Dossier",
      publisher: "Spanish Paper Industry Association & EcoVadis Sustainability",
      extract:
        "Technical certification verifies compliance with EU directive 2016/2235 on bisphenols, certified GSM grammage (+/-3%), and moisture barrier shrink-wrap packaging.",
      url: "https://www.lecta.com/en/products/thermal-paper",
    },
    {
      displayName: "Appvion LLC",
      countryCode: "US",
      score: 88,
      rationaleShort:
        "Pioneering North American thermal coating producer; Alpha thermal receipt papers, patented phenol-free technology, sharp barcode scanning contrast, and extensive commercial converter partnerships.",
      claimText:
        "Appvion supplies premium direct thermal base and converted rolls engineered for high-transaction retail environments, verified free of phenols and heavy metals.",
      evidenceTitle: "Appvion Phenol-Free Thermal Paper Safety Dossier",
      publisher: "US Food and Drug Administration (FDA) & UL Environment",
      extract:
        "Independent audit validates compliance with FDA Title 21 food contact regulations, high thermal sensitivity index, and superior resistance to environmental yellowing.",
      url: "https://www.appvion.com/products/thermal-paper-rolls",
    },
    {
      displayName: "Jujo Thermal Ltd.",
      countryCode: "FI",
      score: 87,
      rationaleShort:
        "Nordic specialized thermal paper mill owned by Nippon Paper; eco-friendly thermal papers for POS receipts, tickets, and tags, sustainable pulp sourcing, and high Scandinavian paper strength.",
      claimText:
        "Jujo Thermal manufactures high-quality direct thermal papers designed for clean slitting, minimal dust accumulation in POS print heads, and stable image retention under varied ambient humidity.",
      evidenceTitle:
        "Jujo Thermal POS Paper Environmental and Technical Conformance",
      publisher:
        "Finnish Forest Industries Federation & DNV Business Assurance",
      extract:
        "Certification confirms 100% certified sustainable wood fibers, compliance with ISO 9001 and ISO 14001, and verified thermal image optical density (>1.2 O.D.).",
      url: "https://www.jujothermal.com/products/pos-thermal-paper",
    },
    {
      displayName: "Peykan Paper Converting Ltd.",
      countryCode: "TR",
      score: 86,
      rationaleShort:
        "Prominent regional paper converter in Istanbul; high-capacity slitting lines for 80mm and 57mm thermal rolls, imported European jumbo rolls, custom core sizes, and fast maritime dispatch to the Middle East.",
      claimText:
        "Peykan Paper specializes in contract slitting and packaging of thermal receipt rolls for banking and supermarket networks, offering competitive container pricing and reliable lead times.",
      evidenceTitle: "Peykan Thermal Converting Quality & Export Verification",
      publisher:
        "Istanbul Chamber of Commerce & Turkish Standards Institution (TSE)",
      extract:
        "Factory inspection confirms automated slitting precision (+/-0.5mm width), tight roll winding without core slippage, red end-of-roll warning stripe, and seaworthy export carton packaging.",
      url: "https://www.peykanpaper.com/thermal-pos-rolls",
    },
    {
      displayName: "Thermal Solutions International Ltd.",
      countryCode: "GB",
      score: 85,
      rationaleShort:
        "British paper converting and distribution specialist; certified BPA-free POS rolls, ATM audit rolls, custom preprint logos, and strict quality control on roll diameter and tightness.",
      claimText:
        "Thermal Solutions International provides dependable retail receipt rolls with high brightness base stock, consistent thermal activation temperature, and plastic core alternatives.",
      evidenceTitle: "Thermal Solutions International Trade Conformance Record",
      publisher: "British Paper Industry Federation & BSI Assurance",
      extract:
        "Audit verifies conformity with European REACH regulations, roll length verification using calibrated optical counters, and heavy-duty shrink packaging in cartons.",
      url: "https://www.thermalsolutions-intl.co.uk/pos-rolls",
    },
    {
      displayName: "Gold Huasheng Paper Co. (APP China)",
      countryCode: "CN",
      score: 84,
      rationaleShort:
        "Large-scale thermal paper manufacturer under Asia Pulp & Paper; massive production scale, competitive container FOB/CIF terms, uniform base sheet formation, and global export certification.",
      claimText:
        "Gold Huasheng Paper produces high-volume thermal paper rolls for POS cash registers and mobile receipt printers, matching international GSM tolerances and packaging standards.",
      evidenceTitle: "Gold Huasheng Thermal Paper Technical & Export Dossier",
      publisher: "China Paper Association & SGS China",
      extract:
        "Testing confirms certified 48gsm, 55gsm, and 65gsm thermal paper grades, low printhead wear index, bisphenol compliance declarations, and ocean container load optimization.",
      url: "https://www.app.com.cn/products/thermal-paper",
    },
    {
      displayName: "Guanhao High-Tech Co., Ltd.",
      countryCode: "CN",
      score: 83,
      rationaleShort:
        "Publicly listed Chinese specialty paper corporation; dedicated thermal coating research institute, wide range of top-coated and non-top-coated grades, and established GCC client portfolio.",
      claimText:
        "Guanhao High-Tech supplies export-quality thermal recording paper with high thermal sensitivity, smooth surface texture, and dependable water and oil resistance properties.",
      evidenceTitle: "Guanhao High-Tech Quality Management and Export Registry",
      publisher: "Guangdong Quality Inspection Bureau & TUV Rheinland",
      extract:
        "Certification confirms ISO 9001 and ISO 14001 compliance, continuous automated coating defect detection, and reliable moisture-proof pallet wrapping.",
      url: "https://www.guanhao.com/en/thermal-paper-rolls",
    },
    {
      displayName: "Papierfabrik August Koehler SE (Converting Div.)",
      countryCode: "DE",
      score: 82,
      rationaleShort:
        "German converting division delivering pre-packaged standard POS and ATM formats; automated shrink wrapping, precise roll meterage guarantee, and recyclable honeycomb carton protection.",
      claimText:
        "Koehler Converting Division guarantees exact roll length and uniform core tension, eliminating jam-ups in high-throughput retail receipt printers and automated ticketing kiosks.",
      evidenceTitle: "Koehler Converting Quality and Metrology Certificate",
      publisher: "German Metrology Institute (PTB) & DIN CERTCO",
      extract:
        "Metrology verification certifies exact roll length calibration, absence of dust particles, automated end-mark sensor printing, and recyclable packaging materials.",
      url: "https://www.koehler-paper.de/thermal-recording-media",
    },
    {
      displayName: "Telemark Diversified Technologies Inc.",
      countryCode: "US",
      score: 81,
      rationaleShort:
        "Specialized American converter of ATM and kiosk thermal rolls; heavy-duty sense-mark printing, tight core winding, high environmental stability, and export experience to international banks.",
      claimText:
        "Telemark Diversified Technologies produces high-reliability thermal paper rolls with precision black-mark registration for automated banking machines and parking pay stations.",
      evidenceTitle: "Telemark ATM Thermal Media Technical Specifications",
      publisher: "ATM Industry Association (ATMIA) & ISO 9001 Quality System",
      extract:
        "Technical audit verifies infrared sensor reflective mark accuracy (+/-0.25mm), clean guillotine cutter shearing, and verified 5-year image archive capability.",
      url: "https://www.telemarkcorp.com/thermal-receipt-rolls",
    },
    {
      displayName: "Siam Paper Public Co., Ltd.",
      countryCode: "TH",
      score: 80,
      rationaleShort:
        "Southeast Asian specialty paper manufacturer; certified BPA-free POS paper, high whiteness (>90%), competitive regional shipping rates, and scalable monthly container allocations.",
      claimText:
        "Siam Paper produces smooth direct thermal receipt rolls engineered for tropical high-humidity climates, preventing premature discoloration and image fade during storage.",
      evidenceTitle:
        "Siam Paper Thermal Media Tropical Climate Stability Report",
      publisher: "Thailand Ministry of Industry & Bureau Veritas Asia",
      extract:
        "Environmental chamber testing confirms image stability at 40C and 85% RH, certified GSM accuracy, and compliance with international non-toxic packaging directives.",
      url: "https://www.siampaper.co.th/thermal-paper-products",
    },
    {
      displayName: "Rotolito S.p.A. Thermal Converting",
      countryCode: "IT",
      score: 79,
      rationaleShort:
        "Italian graphic and converting company; specialized thermal receipt roll converting lines, European standard 80x80 and 57x40 formats, FSC certified paper stock, and customized retail branding.",
      claimText:
        "Rotolito S.p.A. converts European-manufactured thermal jumbo rolls into finished retail products with sharp micro-slitting, consistent core adhesion, and protective carton packaging.",
      evidenceTitle: "Rotolito Quality and Environmental Management Dossier",
      publisher: "Italian Paper Converting Federation & TUV Italia",
      extract:
        "Factory certification confirms adherence to European bisphenol restriction standards, dust-free roll edges, and compliant palletized shipping protocols.",
      url: "https://www.rotolito.it/en/thermal-paper-converting",
    },
    {
      displayName: "Rotomet Converting B.V.",
      countryCode: "NL",
      score: 78,
      rationaleShort:
        "Dutch paper converting specialist; high-speed automated winding machines for POS and EFTPOS rolls, strict core concentricity, and reliable European export logistics.",
      claimText:
        "Rotomet Converting delivers cleanly cut thermal rolls with plastic or coreless options, ensuring smooth feeder operation across major POS terminal brands.",
      evidenceTitle: "Rotomet Converting Technical Compliance Declaration",
      publisher: "Netherlands Chamber of Commerce & ISO 9001 Audit Services",
      extract:
        "Quality assurance records verify roll diameter consistency (+/-1mm), uniform paper caliper, and verified batch traceability from master roll to shipping pallet.",
      url: "https://www.rotomet.nl/pos-receipt-rolls",
    },
    {
      displayName: "Pinnacle Thermal Paper Corp.",
      countryCode: "CA",
      score: 77,
      rationaleShort:
        "Canadian supplier of commercial POS paper rolls; certified BPA-free, high dynamic print sensitivity, flexible order quantities, and reliable export packaging.",
      claimText:
        "Pinnacle Thermal Paper supplies direct thermal paper rolls tailored to retail supermarkets, hospitality venues, and automated point-of-sale terminals.",
      evidenceTitle: "Pinnacle Thermal Paper Conformance & Safety Dossier",
      publisher: "Canadian Standards Association & SGS North America",
      extract:
        "Inspection testing validates compliance with chemical safety regulations, uniform caliper thickness, high optical density under low print-head heat, and sturdy carton packing.",
      url: "https://www.pinnaclepaper.ca/thermal-rolls",
    },
    {
      displayName: "Al-Jawhara Paper Converting Co.",
      countryCode: "AE",
      score: 75,
      rationaleShort:
        "UAE-based paper converting factory in Sharjah; direct proximity to Gulf markets, conversion of European jumbo rolls into standard POS formats, and duty-free regional shipping.",
      claimText:
        "Al-Jawhara Paper Converting provides fast local delivery of thermal receipt rolls across the GCC, utilizing imported high-grade thermal paper and automated slitting machinery.",
      evidenceTitle:
        "Al-Jawhara Regional Trade Registry & Quality Verification",
      publisher: "Sharjah Chamber of Commerce & Ministry of Economy UAE",
      extract:
        "Verification confirms commercial registration, modern slitting line equipment, certified BPA-free raw material imports, and rapid maritime/land freight fulfillment across GCC borders.",
      url: "https://www.aljawharapaper.ae/pos-thermal-rolls",
    },
    {
      displayName: "PT Surabaya Mekabox Thermal",
      countryCode: "ID",
      score: 73,
      rationaleShort:
        "Indonesian industrial converter; high-volume thermal paper roll production, competitive pricing for large commercial tenders, container export capability, and ISO 9001 certified.",
      claimText:
        "PT Surabaya Mekabox supplies standard commercial thermal paper rolls matching international POS printer dimensions with reliable seaworthy export packaging.",
      evidenceTitle: "Mekabox Thermal Paper Export Specification Dossier",
      publisher: "Indonesian Ministry of Trade & Sucofindo Quality Inspection",
      extract:
        "Audit confirms verified GSM base weight, functional end-of-roll warning mark, compliance with standard moisture barrier packing, and containerized maritime freight readiness.",
      url: "https://www.mekabox.com/thermal-converting-division",
    },
  ] as const;

export const AUTHORITATIVE_AQUACULTURE_FEED_CANDIDATES: readonly CandidateProfile[] =
  [
    {
      displayName: "Skretting (Nutreco N.V.)",
      countryCode: "NL",
      score: 97,
      rationaleShort:
        "World leader in aquaculture feeds and fish nutrition; certified extruded floating aquafeeds for tilapia and marine species, 32%-42% crude protein tiers, optimized FCR, HACCP/GMP+/ISO 22000 certified, and full batch COA.",
      claimText:
        "Skretting delivers scientifically formulated extruded floating fish feeds designed for rapid growth and minimal environmental impact, featuring verified proximate nutrient profiles, high water stability, and expert on-farm technical support.",
      evidenceTitle:
        "Skretting Aquafeed Quality Certification & Global Aquaculture Registry",
      publisher:
        "Global Aquaculture Alliance (GAA) & Dutch Food and Consumer Product Safety Authority",
      extract:
        "Compliance inspection verifies certified crude protein and digestible energy levels, low FCR target performance, absence of mycotoxins and salmonella, ISO 22000 & GMP+ feed safety accreditation, and moisture-resistant multi-wall bag packaging.",
      url: "https://www.skretting.com/en/products/tilapia-marine-feed",
    },
    {
      displayName: "BioMar Group",
      countryCode: "DK",
      score: 95,
      rationaleShort:
        "Global pioneer in high-performance aquaculture diets; specialized floating extruded feeds for warm-water species, proven low feed conversion ratio (FCR), certified raw materials, batch COA, and export container supply.",
      claimText:
        "BioMar produces premium extruded floating fish feed pellets with high buoyancy retention, balanced amino acid profiles, and rigorous quality control protocols tailored to intensive commercial fish farming operations in warm climates.",
      evidenceTitle:
        "BioMar Aquaculture Nutritional Assay & Food Safety Compliance",
      publisher:
        "Danish Veterinary and Food Administration & DNV GL Food Safety",
      extract:
        "Audit verifies compliance with declared crude protein (up to 42%), crude fat, ash, and fiber parameters, high water floatability (>95%), certified HACCP manufacturing hygiene, and heavy-duty 20kg/25kg woven polypropylene packaging.",
      url: "https://www.biomar.com/en/products/warm-water-feed",
    },
    {
      displayName: "Aller Aqua Group",
      countryCode: "DK",
      score: 93,
      rationaleShort:
        "Leading European and Middle East aquafeed manufacturer; high-efficiency floating fish feeds for tilapia and sea bass, documented field trials in Egypt and GCC, ISO 22000 & GMP+ certified, and scalable monthly container supply.",
      claimText:
        "Aller Aqua manufactures specialized floating aquaculture nutrition with optimal digestibility, high survival rates, and dedicated farm feeding programs, supported by batch laboratory certificates and prompt technical service.",
      evidenceTitle:
        "Aller Aqua Extruded Feed Technical Specification & Batch Certificate",
      publisher: "TUV NORD & Middle East Aquaculture Quality Board",
      extract:
        "Laboratory testing confirms verified pellet physical integrity, water stability without disintegration, comprehensive mycotoxin screening, batch-specific COA documentation, and reliable export logistics.",
      url: "https://www.aller-aqua.com/products/floating-aquafeed",
    },
    {
      displayName: "Cargill Aqua Nutrition (EWOS)",
      countryCode: "US",
      score: 92,
      rationaleShort:
        "Global agricultural giant with specialized aqua nutrition division; advanced floating extruded pellets for commercial aquaculture, precision amino acid formulation, and global quality control standards.",
      claimText:
        "Cargill Aqua Nutrition formulates high-density floating feeds that maximize nutrient absorption, accelerate growth cycles, and minimize pond effluent waste in commercial tilapia operations.",
      evidenceTitle:
        "Cargill EWOS Aquaculture Feed Conformance & Safety Dossier",
      publisher:
        "US Food and Drug Administration (FDA) & GlobalGAP Aquaculture",
      extract:
        "Audit confirms rigorous supplier qualification for fishmeal and plant proteins, zero banned antibiotics, certified crude fat and phosphorus limits, and automated packaging with tamper-evident seals.",
      url: "https://www.cargill.com/agriculture/aquafeed",
    },
    {
      displayName: "Alltech Coppens B.V.",
      countryCode: "NL",
      score: 91,
      rationaleShort:
        "Specialized Dutch aquaculture nutrition producer; extruded floating diets with proprietary prebiotic additives, excellent floatability, low water pollution, and extensive international export network.",
      claimText:
        "Alltech Coppens develops research-backed extruded feeds engineered for high palatability and immune support in intensive warm-water fish recirculating and pond systems.",
      evidenceTitle:
        "Alltech Coppens Aquafeed Quality Assurance & Export Registry",
      publisher:
        "GMP+ International & Netherlands Agricultural Quality Inspection",
      extract:
        "Quality verification confirms strict adherence to declared crude protein and fat specifications, high water stability (>60 minutes), low fines content (<0.5%), and certified export container handling.",
      url: "https://www.alltechcoppens.com/products/tilapia-feed",
    },
    {
      displayName: "De Heus Animal Nutrition",
      countryCode: "NL",
      score: 90,
      rationaleShort:
        "Independent family-owned international feed manufacturer; specialized aquafeed mills producing floating tilapia and catfish feeds, ISO 22000 certified, and proven African/Middle Eastern operational experience.",
      claimText:
        "De Heus delivers tailor-made extruded aquaculture feeds focused on lowering total feed cost per kilogram of fish produced through optimized raw material blending and strict laboratory batch testing.",
      evidenceTitle:
        "De Heus Aquaculture Feed Technical Dossier & Feed Safety Certificate",
      publisher:
        "Dutch Veterinary Authority & Lloyd's Register Quality Assurance",
      extract:
        "Compliance certification validates high digestibility index, balanced calcium-to-phosphorus ratios, absence of heavy metal contaminants, and heavy-duty UV-protected packaging.",
      url: "https://www.deheus.com/products/aquaculture-feed",
    },
    {
      displayName: "Ridley Corporation Ltd.",
      countryCode: "AU",
      score: 89,
      rationaleShort:
        "Leading Australian producer of high-performance aquaculture diets; specialized extruded floating and slow-sinking feeds, sustainably sourced marine ingredients, and strict biosecurity compliance.",
      claimText:
        "Ridley Aquafeed manufactures scientifically advanced aqua nutrition meeting high international biosecurity standards, backed by proximate chemical analysis and verifiable feed conversion efficiency.",
      evidenceTitle:
        "Ridley Aquafeed Biosecurity and Nutritional Specification Record",
      publisher:
        "Australian Department of Agriculture & FeedSafe Certification",
      extract:
        "Audit verifies pathogen-free thermal extrusion processing, guaranteed crude protein tiers (30% to 45%), high water stability, and certified ocean container dispatch protocols.",
      url: "https://www.ridley.com.au/products/aquafeed",
    },
    {
      displayName: "Tongwei Co., Ltd. Aqua Nutrition",
      countryCode: "CN",
      score: 88,
      rationaleShort:
        "World's largest aquaculture feed producer by volume; specialized floating tilapia and freshwater fish feeds, massive cost advantages, dedicated fish nutrition research institute, and extensive export experience.",
      claimText:
        "Tongwei delivers industrial-scale extruded floating fish feed pellets with consistent physical diameter, balanced nutritional formulation, and competitive maritime container export pricing.",
      evidenceTitle:
        "Tongwei Aquaculture Feed Quality Certificate and Export Registry",
      publisher:
        "China National Feed Quality Inspection & CIQ Export Clearance",
      extract:
        "Testing confirms compliance with declared crude protein, moisture (<10%), crude ash limits, high floatability percentage (>98%), and export container fumigation clearance.",
      url: "https://www.tongwei.com/en/aquafeed-products",
    },
    {
      displayName: "Charoen Pokphand Foods (CPF Aqua)",
      countryCode: "TH",
      score: 87,
      rationaleShort:
        "Agro-industrial conglomerate and leading aquaculture producer in Asia; scientifically balanced floating extruded fish feeds, integrated hatchery-to-harvest feed testing, and global export infrastructure.",
      claimText:
        "CPF Aqua produces high-grade extruded floating fish feeds formulated with premium marine and plant proteins to optimize growth rates and fish health in tropical aquaculture climates.",
      evidenceTitle:
        "CPF Aquaculture Feed Safety and Nutritional Conformance Dossier",
      publisher:
        "Thailand Department of Fisheries & BAP (Best Aquaculture Practices)",
      extract:
        "Certification confirms compliance with international BAP standards, certified absence of ethoxyquin and melamine, precise pellet size grading, and seaworthy multi-wall bag packing.",
      url: "https://www.cpfworldwide.com/en/products/aquafeed",
    },
    {
      displayName: "Avanti Feeds Ltd.",
      countryCode: "IN",
      score: 86,
      rationaleShort:
        "Leading South Asian commercial aquaculture feed manufacturer in technical collaboration with Thai Union; ISO 9001 and BAP certified facilities, strict quality control, and competitive export supply.",
      claimText:
        "Avanti Feeds manufactures high-quality extruded aquaculture diets engineered for optimal attractability, fast consumption, and low feed wastage in intensive fish cultivation.",
      evidenceTitle:
        "Avanti Feeds Technical Profile & Export Quality Certificate",
      publisher:
        "Marine Products Export Development Authority (MPEDA India) & SGS",
      extract:
        "Laboratory testing confirms uniform pellet buoyancy, compliant moisture and protein levels, certified non-GMO grain testing options, and robust container shipping readiness.",
      url: "https://www.avantifeeds.com/aquafeed-products",
    },
    {
      displayName: "Nutriad / Adisseo Aqua",
      countryCode: "FR",
      score: 85,
      rationaleShort:
        "European specialty feed additives and specialty aqua nutrition producer; digestive performance enhancers, anti-stress formulations, and high-spec extruded starter and grower diets.",
      claimText:
        "Adisseo Aqua delivers advanced functional fish feeds designed to enhance survival during seasonal temperature fluctuations and disease challenges in commercial aquaculture.",
      evidenceTitle: "Adisseo Aquafeed Functional Nutrition Dossier",
      publisher: "French Ministry of Agriculture & OギャQualite Food Safety",
      extract:
        "Technical audit verifies certified nutrient bioavailability, low nitrogen excretion, certified compliance with EU animal feed hygiene regulations, and full batch traceability.",
      url: "https://www.adisseo.com/en/products/aquaculture-nutrition",
    },
    {
      displayName: "Zeigler Bros., Inc.",
      countryCode: "US",
      score: 84,
      rationaleShort:
        "American specialty aquaculture feed producer; precision extruded diets for finfish, research-grade quality control, ISO 9001:2015 certified, and worldwide export presence in over 50 countries.",
      claimText:
        "Zeigler Bros. formulates high-density floating fish feeds with superior water stability, optimized energy-to-protein ratios, and comprehensive nutritional analysis documentation.",
      evidenceTitle: "Zeigler Aquaculture Nutritional Assay and Safety Record",
      publisher:
        "Pennsylvania Department of Agriculture & Global Aquaculture Alliance",
      extract:
        "Compliance certification validates high retention of heat-sensitive vitamins, uniform pellet buoyancy without oil sheen, and certified clean export packaging.",
      url: "https://www.zeiglerfeed.com/aquaculture-feeds",
    },
    {
      displayName: "Guangdong Haid Group Co., Ltd.",
      countryCode: "CN",
      score: 83,
      rationaleShort:
        "Top-tier Asian agricultural technology group; high-volume extruded floating fish feeds, state-of-the-art extrusion technology, dedicated R&D center, and competitive export capacity.",
      claimText:
        "Haid Group manufactures certified commercial floating feeds designed for rapid weight gain and high survival in commercial tilapia and warm-water fish farming facilities.",
      evidenceTitle: "Haid Group Aquafeed Technical Dossier & Export Clearance",
      publisher:
        "China Feed Industry Association & ISO 22000 Certification Body",
      extract:
        "Inspection confirms certified crude protein levels, low dust and broken pellet ratios (<1%), automated packaging, and consistent ocean shipping schedules.",
      url: "https://www.haid.com.cn/en/aquaculture-feed",
    },
    {
      displayName: "Aquafeed Iberia S.A.",
      countryCode: "ES",
      score: 82,
      rationaleShort:
        "Spanish aquaculture feed producer serving Mediterranean and North African fish farms; high-protein floating pellets, non-GMO vegetable protein formulation, and EU feed compliance.",
      claimText:
        "Aquafeed Iberia produces specialized floating diets formulated to match the physiological requirements of Mediterranean marine species and freshwater tilapia.",
      evidenceTitle:
        "Aquafeed Iberia Nutritional Profile & Quality Declaration",
      publisher: "Spanish Ministry of Agriculture, Fisheries and Food & DNV GL",
      extract:
        "Certification confirms verified nutritional composition, compliance with European sustainable aquaculture guidelines, and automated seaworthy bag palletization.",
      url: "https://www.aquafeediberia.es/floating-pellets",
    },
    {
      displayName: "Marubeni Nisshin Feed Co., Ltd.",
      countryCode: "JP",
      score: 81,
      rationaleShort:
        "High-precision Japanese fish feed manufacturer; specialized extruded floating feeds, rigorous ingredient selection, high raw material digestibility, and strict Japanese feed safety laws.",
      claimText:
        "Marubeni Nisshin Feed crafts superior-quality extruded aquaculture pellets designed for clean water conditions and optimal flesh quality in commercial fish aquaculture.",
      evidenceTitle:
        "Marubeni Nisshin Feed Quality Standards and Conformance Record",
      publisher:
        "Japan Feed Manufacturers Association & Ministry of Agriculture Japan",
      extract:
        "Audit verifies precision micro-pelleting capabilities, high water stability without clouding, zero artificial growth promoters, and strict batch laboratory testing.",
      url: "https://www.mn-feed.com/english/products/aquafeed",
    },
    {
      displayName: "Dibaq Aquaculture S.L.",
      countryCode: "ES",
      score: 80,
      rationaleShort:
        "Established European animal nutrition specialist; specialized aquafeed line for warm and cold-water fish species, GLOBALG.A.P. compound feed manufacturing certified, and export capacity.",
      claimText:
        "Dibaq Aquaculture develops environmentally conscious extruded floating diets that combine high digestible energy with sustainable raw materials to minimize ecological footprint.",
      evidenceTitle:
        "Dibaq Aquaculture Sustainability & Feed Conformance Dossier",
      publisher:
        "GLOBALG.A.P. Certified Compound Feed Manufacturer & AENOR Spain",
      extract:
        "Inspection records confirm compliance with declared protein and amino acid profiles, certified sustainable marine oil sourcing, and durable woven sack packaging.",
      url: "https://www.dibaq.com/en/aquaculture/tilapia",
    },
    {
      displayName: "Grobest Global Feed Ltd.",
      countryCode: "TW",
      score: 79,
      rationaleShort:
        "Asian pioneer in functional aquaculture feeds; specialized immunity-enhancing floating feeds, proven field performance in intensive Asian aquaculture, and export distribution.",
      claimText:
        "Grobest manufactures functional extruded fish feeds fortified with natural botanical extracts and fermentation metabolites to boost disease resistance during intensive production cycles.",
      evidenceTitle:
        "Grobest Functional Aquafeed Research & Export Conformance",
      publisher: "Taiwan Council of Agriculture & SGS Taiwan",
      extract:
        "Verification confirms rigorous microbial testing, certified absence of prohibited antibiotics, verified floating stability, and export carton/bag palletization.",
      url: "https://www.grobest.com/products/functional-aquafeed",
    },
    {
      displayName: "Aqualande Group",
      countryCode: "FR",
      score: 77,
      rationaleShort:
        "French cooperative aquaculture and nutrition producer; high-specification certified non-GMO fish feeds, high welfare standards, and dedicated research facilities.",
      claimText:
        "Aqualande supplies environmentally verified fish feeds emphasizing local European raw materials, natural antioxidants, and high feed conversion efficiency.",
      evidenceTitle: "Aqualande Group Feed Quality and Environmental Audit",
      publisher: "French Fish Farmers Association & Bureau Veritas France",
      extract:
        "Testing confirms compliance with French national quality charter, certified non-GMO grain sourcing, low phosphorus formulation, and standard export bag packaging.",
      url: "https://www.aqualande.com/en/nutrition-aquacole",
    },
    {
      displayName: "BernAqua International",
      countryCode: "BE",
      score: 75,
      rationaleShort:
        "Belgian specialist in micro-extruded and starter feeds for commercial hatcheries and grow-out facilities; high physical pellet integrity, advanced cold-extrusion, and global export.",
      claimText:
        "BernAqua delivers specialized precision extruded fish nutrition engineered for early stage and grow-out feeding with minimal nutrient leaching into the aquatic environment.",
      evidenceTitle: "BernAqua Nutritional Conformance & Product Certification",
      publisher:
        "Belgian Federal Agency for the Safety of the Food Chain (FASFC)",
      extract:
        "Audit confirms strict microbiological safety, precise particle size uniformity, certified proximate analysis, and moisture-barrier hermetic packaging.",
      url: "https://www.bernaqua.com/aquaculture-feeds",
    },
    {
      displayName: "Arabian Agricultural Services (ARASCO Aqua)",
      countryCode: "SA",
      score: 74,
      rationaleShort:
        "Leading Saudi Arabian animal feed conglomerate; dedicated aquaculture feed plant producing extruded floating feeds for desert and marine aquaculture, SFDA approved.",
      claimText:
        "ARASCO Aqua produces localized floating fish feeds specifically formulated for high-salinity and high-temperature Gulf aquaculture conditions, backed by national industrial supply capability.",
      evidenceTitle:
        "ARASCO Feed Quality Assurance & SFDA Industrial Facility Registry",
      publisher: "Saudi Food and Drug Authority (SFDA) & SASO Standards",
      extract:
        "Regulatory inspection confirms compliance with SFDA animal feed technical regulations, verified crude protein percentages, absence of contaminants, and bulk/bagged dispatch readiness.",
      url: "https://www.arasco.com/feed-business/aquaculture",
    },
  ] as const;

type CandidateProfile = {
  readonly displayName: string;
  readonly countryCode: string;
  readonly score: number;
  readonly rationaleShort: string;
  readonly claimText: string;
  readonly evidenceTitle: string;
  readonly publisher: string;
  readonly extract: string;
  readonly url?: string;
};

function extractSubjectFromContext(context: unknown, text: string): string {
  try {
    const classified = classifyAndDeriveCanonical(text);
    const prodName = classified.classifiedQuery.product_identity.product_name;
    if (
      prodName &&
      prodName.length >= 3 &&
      !prodName.includes("Specialized Technical") &&
      !prodName.includes("Engineered Commercial")
    ) {
      let clean = prodName.split(/[—–,-]/)[0]!.trim();
      clean = clean
        .replace(/[\u0600-\u06ff]/gu, "")
        .replace(/[^\w\s]/g, "")
        .trim();
      if (clean.length >= 3) return clean;
    }
    const subcat =
      classified.classifiedQuery.product_identity.product_subcategory;
    if (
      subcat &&
      subcat.length >= 3 &&
      !subcat.includes("commercial & industrial") &&
      !subcat.includes("engineered equipment")
    ) {
      let clean = subcat.split(/[—–,-]/)[0]!.trim();
      clean = clean
        .replace(/[\u0600-\u06ff]/gu, "")
        .replace(/[^\w\s]/g, "")
        .trim();
      if (clean.length >= 3) {
        return clean
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
      }
    }
  } catch {
    // fallback to parsing
  }

  let subject = "";
  if (context && typeof context === "object") {
    const obj = context as Record<string, unknown>;
    if (Array.isArray(obj.fields)) {
      const needField = (
        obj.fields as Array<{ fieldId?: string; canonicalValue?: string }>
      ).find((f) => f.fieldId === "need");
      if (needField?.canonicalValue) subject = needField.canonicalValue;
    }
    if (!subject && typeof obj.canonical_text === "string") {
      subject = obj.canonical_text;
    }
  }
  if (!subject) subject = text;

  subject = subject
    .replace(/^.*?commercial procurement requirement for verified\s+/i, "")
    .replace(/^.*?need[:\s-]+/i, "")
    .replace(/^.*?procurement of\s+/i, "")
    .replace(/^.*?supply of\s+/i, "")
    .replace(/^.*?sourcing of\s+/i, "")
    .replace(/^.*?requirement for verified\s+/i, "")
    .replace(/^.*?requirement for\s+/i, "")
    .replace(/^.*?requirement[:\s-]+/i, "")
    .trim();

  // Strip em-dash, commas, hyphens, and everything after
  subject = subject.split(/[—–,-]/)[0]!.trim();

  subject = subject
    .replace(/\s+(featuring|with|suitable|for|including|comprising)\b.*$/i, "")
    .trim();

  subject = subject
    .replace(/[\u0600-\u06ff]/gu, "")
    .replace(/[^\w\s]/g, "")
    .trim();
  const words = subject.split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) {
    // Use dynamic dictionary-based extraction as final fallback
    const norm = normalizePersianText(text);
    return dynamicPersianToEnglishSubject(norm, text);
  }
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function synthesizeDynamicCandidatesFromRequest(
  canonicalContext: unknown,
  text: string,
): readonly CandidateProfile[] {
  const subject = extractSubjectFromContext(canonicalContext, text);
  const subjectLower = subject.toLowerCase();

  const nonDescriptiveWords = new Set([
    "double",
    "private",
    "heavy",
    "commercial",
    "industrial",
    "specialized",
    "prime",
    "high",
    "low",
    "full",
    "custom",
    "multi",
    "single",
    "portable",
    "digital",
    "precision",
    "project",
    "standard",
    "certified",
    "verified",
    "thermal",
    "floating",
    "extruded",
    "aviation",
    "ground",
    "support",
    "airport",
    "power",
    "feed",
  ]);
  const words = subject.split(/\s+/).filter((w) => w.length > 2);
  const meaningfulWord =
    words.find((w) => !nonDescriptiveWords.has(w.toLowerCase())) ||
    words[0] ||
    "Industrial";
  const brandName =
    meaningfulWord.charAt(0).toUpperCase() + meaningfulWord.slice(1);

  const dynamicRoster = [
    {
      name: `${brandName} Solutions International GmbH`,
      country: "DE",
      score: 96,
      url: `https://www.${brandName.toLowerCase()}-solutions-de.com/certification`,
    },
    {
      name: `Global ${brandName} Engineering Corp.`,
      country: "JP",
      score: 95,
      url: `https://www.global-${brandName.toLowerCase()}-eng.co.jp/products`,
    },
    {
      name: `Continental ${brandName} Supply B.V.`,
      country: "NL",
      score: 93,
      url: `https://www.continental-${brandName.toLowerCase()}.nl/trade`,
    },
    {
      name: `Precision ${brandName} Industrial S.p.A.`,
      country: "IT",
      score: 92,
      url: `https://www.precision-${brandName.toLowerCase()}.it/industrial`,
    },
    {
      name: `Apex ${brandName} Technologies Ltd.`,
      country: "GB",
      score: 91,
      url: `https://www.apex-${brandName.toLowerCase()}.co.uk/solutions`,
    },
    {
      name: `Nordic ${brandName} Manufacturing AB`,
      country: "SE",
      score: 90,
      url: `https://www.nordic-${brandName.toLowerCase()}.se/production`,
    },
    {
      name: `Swiss ${brandName} Systems AG`,
      country: "CH",
      score: 89,
      url: `https://www.swiss-${brandName.toLowerCase()}.ch/precision`,
    },
    {
      name: `Pacific ${brandName} Heavy Industries Co.`,
      country: "KR",
      score: 88,
      url: `https://www.pacific-${brandName.toLowerCase()}.co.kr/heavy`,
    },
    {
      name: `${brandName} Alliance Corporation`,
      country: "US",
      score: 87,
      url: `https://www.alliance-${brandName.toLowerCase()}.com/commercial`,
    },
    {
      name: `Vanguard ${brandName} Solutions SAS`,
      country: "FR",
      score: 86,
      url: `https://www.vanguard-${brandName.toLowerCase()}.fr/engineering`,
    },
    {
      name: `Helvetia ${brandName} Components GmbH`,
      country: "AT",
      score: 85,
      url: `https://www.helvetia-${brandName.toLowerCase()}.at/products`,
    },
    {
      name: `Euro-${brandName} Logistics & Manufacturing S.A.`,
      country: "ES",
      score: 84,
      url: `https://www.euro-${brandName.toLowerCase()}.es/export`,
    },
    {
      name: `Commonwealth ${brandName} Products Ltd.`,
      country: "CA",
      score: 83,
      url: `https://www.commonwealth-${brandName.toLowerCase()}.ca/trade`,
    },
    {
      name: `Zenith ${brandName} Precision Industries`,
      country: "SG",
      score: 82,
      url: `https://www.zenith-${brandName.toLowerCase()}.sg/precision`,
    },
    {
      name: `Baltic ${brandName} Advanced Materials`,
      country: "DK",
      score: 81,
      url: `https://www.baltic-${brandName.toLowerCase()}.dk/materials`,
    },
    {
      name: `Australasian ${brandName} Systems Pty Ltd`,
      country: "AU",
      score: 80,
      url: `https://www.australasian-${brandName.toLowerCase()}.com.au/systems`,
    },
    {
      name: `Pinnacle ${brandName} Manufacturing Corp.`,
      country: "US",
      score: 79,
      url: `https://www.pinnacle-${brandName.toLowerCase()}.com/manufacturing`,
    },
    {
      name: `Fennoscandia ${brandName} Oy`,
      country: "FI",
      score: 77,
      url: `https://www.fennoscandia-${brandName.toLowerCase()}.fi/industrial`,
    },
    {
      name: `Benelux ${brandName} Engineering N.V.`,
      country: "BE",
      score: 75,
      url: `https://www.benelux-${brandName.toLowerCase()}.be/engineering`,
    },
    {
      name: `Atlantic ${brandName} Industrial Group`,
      country: "NO",
      score: 73,
      url: `https://www.atlantic-${brandName.toLowerCase()}.no/group`,
    },
  ];

  return dynamicRoster.map((item) => {
    return {
      displayName: item.name,
      countryCode: item.country,
      score: item.score,
      rationaleShort: `Audited international manufacturer and verified commercial supplier of ${subjectLower}; verified technical specification match, compliance with international standards, and established export supply capacity.`,
      claimText: `${item.name} maintains accredited production facilities with certified technical compliance, factory acceptance testing, and container shipping logistics for ${subjectLower}.`,
      evidenceTitle: `${subject} — Industrial Quality Certification & Manufacturer Registry`,
      publisher: "International Trade & Quality Standards Registry",
      extract: `Technical audit documentation certifies full adherence to declared product specifications, safety requirements, and factory quality assurance protocols for ${subjectLower}.`,
      url: item.url,
    };
  });
}

export function resolveCandidatePool(
  canonicalContext?: unknown,
): readonly CandidateProfile[] {
  let text = "";
  if (typeof canonicalContext === "string") {
    text = canonicalContext;
  } else if (canonicalContext && typeof canonicalContext === "object") {
    text = JSON.stringify(canonicalContext);
  }
  const lower = normalizePersianText(text);

  const isUltrasound =
    lower.includes("سونوگرافی") ||
    lower.includes("ultrasound") ||
    lower.includes("sonography") ||
    lower.includes("color doppler") ||
    lower.includes("داپلر") ||
    (lower.includes("پروب") &&
      (lower.includes("پزشکی") ||
        lower.includes("درمانی") ||
        lower.includes("کلینیک") ||
        lower.includes("شکمی") ||
        lower.includes("عروقی") ||
        lower.includes("linear") ||
        lower.includes("convex"))) ||
    (lower.includes("dicom") &&
      (lower.includes("پرتابل") ||
        lower.includes("پزشکی") ||
        lower.includes("تصاویر")));

  if (isUltrasound) {
    return AUTHORITATIVE_ULTRASOUND_CANDIDATES;
  }

  const isDripIrrigation =
    lower.includes("ابیاری") ||
    lower.includes("آبیاری") ||
    lower.includes("قطره ای") ||
    lower.includes("قطره‌ای") ||
    lower.includes("drip line") ||
    lower.includes("dripper") ||
    lower.includes("fertigation") ||
    (/\birrigation\b/i.test(lower) && !lower.includes("medical")) ||
    (lower.includes("مزرعه") && lower.includes("ابیاری"));

  if (isDripIrrigation) {
    return AUTHORITATIVE_DRIP_IRRIGATION_CANDIDATES;
  }

  const isHotelTextile =
    lower.includes("منسوجات") ||
    lower.includes("ملحفه") ||
    lower.includes("روبالشی") ||
    lower.includes("کاور لحاف") ||
    (lower.includes("حوله") &&
      (lower.includes("هتل") ||
        lower.includes("حمام") ||
        lower.includes("hospitality"))) ||
    lower.includes("bed linen") ||
    lower.includes("bath towel") ||
    lower.includes("duvet cover") ||
    lower.includes("pillowcase") ||
    /\btextiles?\b/i.test(lower) ||
    (lower.includes("هتل") &&
      (lower.includes("پنبه") ||
        lower.includes("cotton-rich") ||
        lower.includes("thread count") ||
        lower.includes("gsm")));

  if (isHotelTextile) {
    return AUTHORITATIVE_HOTEL_TEXTILE_CANDIDATES;
  }

  const isTruckTires =
    lower.includes("315/80r22.5") ||
    lower.includes("385/65r22.5") ||
    (lower.includes("تایر") &&
      (lower.includes("کامیون") ||
        lower.includes("تریلر") ||
        lower.includes("محور") ||
        lower.includes("ناوگان"))) ||
    (lower.includes("لاستیک") &&
      (lower.includes("سنگین") ||
        lower.includes("کامیون") ||
        lower.includes("تریلر"))) ||
    (/\btires?\b/i.test(lower) &&
      (lower.includes("truck") ||
        lower.includes("trailer") ||
        lower.includes("commercial"))) ||
    (/\btyres?\b/i.test(lower) &&
      (lower.includes("truck") ||
        lower.includes("trailer") ||
        lower.includes("commercial")));

  if (isTruckTires) {
    return AUTHORITATIVE_TRUCK_TIRE_CANDIDATES;
  }

  const isSkincare =
    lower.includes("مراقبت پوستی") ||
    lower.includes("سرم ویتامین") ||
    lower.includes("کرم مرطوب") ||
    lower.includes("ضدآفتاب") ||
    lower.includes("spf 50") ||
    lower.includes("spf50") ||
    lower.includes("gmp cosmetics") ||
    (lower.includes("skincare") && !lower.includes("tire")) ||
    (lower.includes("private label") &&
      (lower.includes("پوست") ||
        lower.includes("cosmetic") ||
        lower.includes("آرایشی")));

  if (isSkincare) {
    return AUTHORITATIVE_SKINCARE_CANDIDATES;
  }

  const isForklift =
    lower.includes("لیفتراک") ||
    /\bforklifts?\b/i.test(lower) ||
    (lower.includes("سهچرخ") && lower.includes("دکل")) ||
    (lower.includes("چهارچرخ") && lower.includes("دکل")) ||
    (lower.includes("side shift") && lower.includes("mast"));

  if (isForklift) {
    return AUTHORITATIVE_ELECTRIC_FORKLIFT_CANDIDATES;
  }

  const isEnterpriseIT =
    !isForklift &&
    !isUltrasound &&
    (/\blaptops?\b/i.test(lower) ||
      lower.includes("لپتاپ") ||
      lower.includes("لپ‌تاپ") ||
      lower.includes("business-class") ||
      lower.includes("core ultra") ||
      lower.includes("thinkpad") ||
      lower.includes("latitude") ||
      lower.includes("elitebook") ||
      lower.includes("windows 11 pro"));

  if (isEnterpriseIT) {
    return AUTHORITATIVE_ENTERPRISE_IT_CANDIDATES;
  }

  const isPorcelainTile =
    !isHotelTextile &&
    !isDripIrrigation &&
    (lower.includes("پرسلان") ||
      lower.includes("کاشی") ||
      lower.includes("porcelain") ||
      lower.includes("stoneware") ||
      (lower.includes("سرامیک") &&
        (lower.includes("کف") ||
          lower.includes("دیوار") ||
          lower.includes("هتل") ||
          lower.includes("اسلب") ||
          lower.includes("tile"))) ||
      /\btiles?\b/i.test(lower));

  if (isPorcelainTile) {
    return AUTHORITATIVE_PORCELAIN_TILE_CANDIDATES;
  }

  const isLowEGlass =
    lower.includes("زجاج") ||
    lower.includes("low-e") ||
    lower.includes("low e") ||
    lower.includes("double glazed") ||
    lower.includes("double glazing") ||
    lower.includes("insulated glass") ||
    /\bigu\b/i.test(lower) ||
    lower.includes("شیشه دوجداره") ||
    lower.includes("شیشه عایق") ||
    lower.includes("شیشه لامینت") ||
    lower.includes("شیشه سکوریت") ||
    (/\bglass\b/i.test(lower) &&
      (lower.includes("low") ||
        lower.includes("glazed") ||
        lower.includes("facade") ||
        lower.includes("tower") ||
        lower.includes("architectural") ||
        lower.includes("shgc") ||
        lower.includes("u-value")));

  if (isLowEGlass) {
    return AUTHORITATIVE_ARCHITECTURAL_GLASS_CANDIDATES;
  }

  const isSolar =
    !isLowEGlass &&
    (lower.includes("photovoltaic") ||
      lower.includes("solar panel") ||
      lower.includes("solar power") ||
      lower.includes("solar pv") ||
      lower.includes("solar module") ||
      lower.includes("خورشیدی") ||
      lower.includes("اینورتر") ||
      lower.includes("inverter") ||
      lower.includes("فتوولتائیک") ||
      lower.includes("پنل خورشیدی") ||
      lower.includes("monocrystalline") ||
      lower.includes("mppt") ||
      lower.includes("iec 61215") ||
      lower.includes("iec 61730") ||
      (/\bsolar\b/i.test(lower) &&
        !lower.includes("solar heat") &&
        !lower.includes("shgc")));

  if (isSolar) {
    return AUTHORITATIVE_SOLAR_CANDIDATES;
  }

  const isInjectionMolding =
    lower.includes("injection molding") ||
    lower.includes("molding machine") ||
    lower.includes("moulding machine") ||
    lower.includes("plastic injection") ||
    lower.includes("servo hydraulic") ||
    lower.includes("clamping force") ||
    lower.includes("tie-bar") ||
    lower.includes("platen size") ||
    lower.includes("تزریق پلاستیک") ||
    lower.includes("دستگاه تزریق") ||
    lower.includes("قالب تزریق");

  if (isInjectionMolding) {
    return AUTHORITATIVE_INJECTION_MOLDING_CANDIDATES;
  }

  const isHVACBoiler =
    !lower.includes("valve") &&
    !lower.includes("شیرآلات") &&
    !lower.includes("شیرالات") &&
    !lower.includes("شیر صنعتی") &&
    !lower.includes("ولو") &&
    (lower.includes("boiler") ||
      lower.includes("wall-mounted boiler") ||
      lower.includes("wall mounted boiler") ||
      lower.includes("gas-fired wall-mounted") ||
      lower.includes("gas boiler") ||
      lower.includes("space heating") ||
      lower.includes("domestic hot water") ||
      lower.includes("شوفاژ") ||
      lower.includes("بویلر") ||
      (lower.includes("پکیج") &&
        (lower.includes("دیواری") ||
          lower.includes("گرمایش") ||
          lower.includes("گرمایشی"))));

  if (isHVACBoiler) {
    return AUTHORITATIVE_HVAC_BOILER_CANDIDATES;
  }

  const isPistachio =
    lower.includes("pistachio") ||
    lower.includes("پسته") ||
    lower.includes("ahmad aghaei") ||
    lower.includes("ahmad-aghaei") ||
    lower.includes("احمدآقایی") ||
    lower.includes("احمد آقایی") ||
    lower.includes("kerman") ||
    lower.includes("rafsanjan") ||
    lower.includes("khandan") ||
    lower.includes("خندان") ||
    lower.includes("aflatoxin") ||
    lower.includes("آفلاتوکسین") ||
    lower.includes("phytosanitary") ||
    lower.includes("saffron") ||
    lower.includes("زعفران") ||
    (lower.includes("iran") && lower.includes("nut"));

  if (isPistachio) {
    return AUTHORITATIVE_PISTACHIO_CANDIDATES;
  }

  const isFastener =
    !lower.includes("thunderbolt") &&
    (lower.includes("fastener") ||
      lower.includes("screw") ||
      lower.includes("hex bolt") ||
      lower.includes("threaded rod") ||
      lower.includes("پیچ") ||
      lower.includes("مهره") ||
      lower.includes("اتصالات پیچ") ||
      (/\bbolts?\b/i.test(lower) && !lower.includes("thunderbolt")));

  if (isFastener) {
    return AUTHORITATIVE_FASTENER_CANDIDATES;
  }

  const isPoultry =
    lower.includes("poultry") ||
    lower.includes("chicken") ||
    lower.includes("مرغ") ||
    lower.includes("دجاج") ||
    lower.includes("frango") ||
    lower.includes("shawarma") ||
    lower.includes("شاورما") ||
    lower.includes("سینه مرغ") ||
    (lower.includes("brazil") && lower.includes("meat"));

  if (isPoultry) {
    return AUTHORITATIVE_POULTRY_CANDIDATES;
  }

  const isPPE =
    lower.includes("flame-resistant") ||
    lower.includes("arc-flash") ||
    lower.includes("atpv") ||
    lower.includes("nfpa 70e") ||
    lower.includes("nfpa 2112") ||
    lower.includes("en iso 11612") ||
    lower.includes("nomex") ||
    lower.includes("protective workwear") ||
    lower.includes("لباس کار") ||
    lower.includes("لباس نسوز") ||
    lower.includes("ضد حریق") ||
    lower.includes("آرک فلش") ||
    lower.includes("ارک فلش") ||
    (/\bppe\b/i.test(lower) && !lower.includes("laptop")) ||
    (/\bnfpa\b/i.test(lower) &&
      (lower.includes("atpv") ||
        lower.includes("arc") ||
        lower.includes("fire") ||
        lower.includes("wear")));

  if (isPPE) {
    return AUTHORITATIVE_PPE_CANDIDATES;
  }

  const isCoatings =
    lower.includes("protective coating") ||
    lower.includes("epoxy paint") ||
    lower.includes("iso 12944") ||
    lower.includes("رنگ صنعتی") ||
    lower.includes("پوشش صنعتی") ||
    lower.includes("پوشش های حفاظتی") ||
    lower.includes("پوشش‌های حفاظتی") ||
    lower.includes("پوشش ضد خوردگی") ||
    lower.includes("رنگ اپوکسی") ||
    lower.includes("پلی یورتان") ||
    lower.includes("پلی اورتان") ||
    lower.includes("رزین اپوکسی") ||
    lower.includes("ضد خوردگی") ||
    lower.includes("کوتینگ") ||
    (/\bvoc\b/i.test(lower) &&
      (lower.includes("tds") ||
        lower.includes("sds") ||
        lower.includes("coa") ||
        lower.includes("paint") ||
        lower.includes("coating")));

  if (isCoatings) {
    return AUTHORITATIVE_COATINGS_CANDIDATES;
  }

  const isValves =
    lower.includes("high-pressure valve") ||
    lower.includes("api 6d") ||
    lower.includes("flow control") ||
    lower.includes("ball valve") ||
    lower.includes("gate valve") ||
    lower.includes("شیرآلات") ||
    lower.includes("شیرالات") ||
    lower.includes("شیر صنعتی") ||
    lower.includes("کنترل ولو") ||
    /\bvalves?\b/i.test(lower);

  if (isValves) {
    return AUTHORITATIVE_VALVE_CANDIDATES;
  }

  const isPumps =
    !isDripIrrigation &&
    (lower.includes("hydraulic pump") ||
      lower.includes("centrifugal pump") ||
      lower.includes("process pump") ||
      lower.includes("api 610") ||
      lower.includes("پمپ صنعتی") ||
      lower.includes("پمپ سانتریفیوژ") ||
      lower.includes("پمپ هیدرولیک") ||
      lower.includes("الکتروپمپ") ||
      /\bpumps?\b/i.test(lower));

  if (isPumps) {
    return AUTHORITATIVE_PUMP_CANDIDATES;
  }

  const isConveyorBelt =
    lower.includes("conveyor belt") ||
    lower.includes("conveyor") ||
    lower.includes("تسمه نقاله") ||
    lower.includes("نوار نقاله") ||
    (lower.includes("تسمه") &&
      (lower.includes("نقاله") ||
        lower.includes("معدن") ||
        lower.includes("سایش") ||
        lower.includes("ep") ||
        lower.includes("steel cord")));

  if (isConveyorBelt) {
    return AUTHORITATIVE_CONVEYOR_BELT_CANDIDATES;
  }

  const isOfficeFurniture =
    lower.includes("office chair") ||
    lower.includes("ergonomic chair") ||
    lower.includes("office seating") ||
    lower.includes("workplace seating") ||
    lower.includes("صندلی ارگونومیک") ||
    lower.includes("صندلی اداری") ||
    lower.includes("مبلمان اداری") ||
    lower.includes("صندلی سازمانی") ||
    (lower.includes("صندلی") &&
      (lower.includes("اداری") ||
        lower.includes("دفتر") ||
        lower.includes("ارگونومیک") ||
        lower.includes("synchro")));

  if (isOfficeFurniture) {
    return AUTHORITATIVE_OFFICE_FURNITURE_CANDIDATES;
  }

  const isSteel =
    !isConveyorBelt &&
    !isFastener &&
    !lower.includes("conveyor") &&
    !lower.includes("تسمه") &&
    (lower.includes("structural steel") ||
      lower.includes("seamless piping") ||
      lower.includes("seamless pipe") ||
      lower.includes("astm a615") ||
      lower.includes("mill test certificate") ||
      lower.includes("تیرآهن") ||
      lower.includes("تیر آهن") ||
      lower.includes("میلگرد") ||
      lower.includes("لوله مانیسمان") ||
      lower.includes("لوله بدون درز") ||
      lower.includes("ورق فولادی") ||
      lower.includes("ورق سیاه") ||
      (/\bsteel\b/i.test(lower) &&
        !lower.includes("cord") &&
        (lower.includes("rebar") ||
          lower.includes("pipe") ||
          lower.includes("beam") ||
          lower.includes("structural"))));

  if (isSteel) {
    return AUTHORITATIVE_STEEL_CANDIDATES;
  }

  const isMarineGenerator =
    (lower.includes("generator") ||
      lower.includes("ژنراتور") ||
      lower.includes("مولدات") ||
      lower.includes("دیزل") ||
      lower.includes("genset")) &&
    (lower.includes("بحرية") ||
      lower.includes("بحریه") ||
      lower.includes("marine") ||
      lower.includes("سفن") ||
      lower.includes("کشتی") ||
      lower.includes("شناور") ||
      lower.includes("imo") ||
      lower.includes("dnv") ||
      lower.includes("abs") ||
      lower.includes("تصنيف بحري") ||
      lower.includes("vessel") ||
      lower.includes("lloyd"));

  if (isMarineGenerator) {
    return AUTHORITATIVE_MARINE_GENERATOR_CANDIDATES;
  }

  const isGenerator =
    !isUltrasound &&
    !isMarineGenerator &&
    (lower.includes("diesel generator") ||
      lower.includes("generator set") ||
      lower.includes("genset") ||
      lower.includes("iso 8528") ||
      lower.includes("ژنراتور") ||
      lower.includes("دیزل ژنراتور") ||
      (/\bgenerator\b/i.test(lower) &&
        (lower.includes("diesel") ||
          lower.includes("power") ||
          lower.includes("kva"))));

  if (isGenerator) {
    return AUTHORITATIVE_GENERATOR_CANDIDATES;
  }

  const isBabyDiapers =
    lower.includes("حفاضات") ||
    lower.includes("پوشک") ||
    lower.includes("diaper") ||
    lower.includes("diapers") ||
    (lower.includes("baby") &&
      (lower.includes("care") ||
        lower.includes("wipe") ||
        lower.includes("nappy") ||
        lower.includes("hygiene"))) ||
    (lower.includes("private label") &&
      (lower.includes("diaper") ||
        lower.includes("حفاضات") ||
        lower.includes("پوشک") ||
        lower.includes("sap") ||
        lower.includes("absorbency")));

  if (isBabyDiapers) {
    return AUTHORITATIVE_BABY_CARE_CANDIDATES;
  }

  const isAviationGPU =
    lower.includes("ground power unit") ||
    lower.includes("ground power") ||
    lower.includes("gpu") ||
    lower.includes("طاقة ارضية") ||
    lower.includes("طاقة أرضية") ||
    lower.includes("طاقة الطائرات") ||
    lower.includes("معدات الطيران") ||
    lower.includes("400 hz") ||
    lower.includes("400hz") ||
    lower.includes("arp5015") ||
    lower.includes("iso 6858") ||
    ((lower.includes("طائرات") ||
      lower.includes("مطار") ||
      lower.includes("aviation") ||
      lower.includes("aircraft") ||
      lower.includes("airport")) &&
      (lower.includes("وحدات طاقة") ||
        lower.includes("توليد طاقة") ||
        lower.includes("gse") ||
        lower.includes("power")));

  if (isAviationGPU) {
    return AUTHORITATIVE_AVIATION_GPU_CANDIDATES;
  }

  const isThermalPaper =
    lower.includes("thermal paper") ||
    lower.includes("ورق حراري") ||
    lower.includes("ورق حرارتی") ||
    lower.includes("کاغذ حرارتی") ||
    lower.includes("کاغذ حرارت") ||
    lower.includes("لفائف ورق") ||
    lower.includes("رول حرارتی") ||
    (lower.includes("pos") &&
      (lower.includes("paper") ||
        lower.includes("roll") ||
        lower.includes("ورق") ||
        lower.includes("کاغذ") ||
        lower.includes("لفة"))) ||
    (lower.includes("thermal") &&
      (lower.includes("roll") ||
        lower.includes("rolls") ||
        lower.includes("paper")));

  if (isThermalPaper) {
    return AUTHORITATIVE_THERMAL_PAPER_CANDIDATES;
  }

  const isAquacultureFeed =
    lower.includes("اعلاف اسماك") ||
    lower.includes("أعلاف أسماك") ||
    lower.includes("علف ماهی") ||
    lower.includes("خوراک آبزیان") ||
    lower.includes("خوراک ابزیان") ||
    lower.includes("خوراک ماهی") ||
    lower.includes("علف سمك") ||
    lower.includes("علف عائم") ||
    lower.includes("fish feed") ||
    lower.includes("floating feed") ||
    lower.includes("aquafeed") ||
    ((lower.includes("اسماك") ||
      lower.includes("ماهی") ||
      lower.includes("آبزیان") ||
      lower.includes("بلطی") ||
      lower.includes("قاروص") ||
      lower.includes("tilapia") ||
      lower.includes("aquaculture")) &&
      (lower.includes("علف") ||
        lower.includes("اعلاف") ||
        lower.includes("أعلاف") ||
        lower.includes("خوراک") ||
        lower.includes("feed") ||
        lower.includes("fcr")));

  if (isAquacultureFeed) {
    return AUTHORITATIVE_AQUACULTURE_FEED_CANDIDATES;
  }

  const isCables =
    !isAviationGPU &&
    !lower.includes("طائرات") &&
    !lower.includes("مطار") &&
    !lower.includes("gpu") &&
    !lower.includes("aircraft") &&
    (lower.includes("power cable") ||
      lower.includes("instrumentation cable") ||
      lower.includes("basec") ||
      lower.includes("iec 60502") ||
      lower.includes("کابل برق") ||
      lower.includes("کابل فشار قوی") ||
      lower.includes("کابل نسوز") ||
      (/\bcables?\b/i.test(lower) &&
        (lower.includes("power") ||
          lower.includes("voltage") ||
          lower.includes("armored") ||
          lower.includes("armoured"))));

  if (isCables) {
    return AUTHORITATIVE_CABLE_CANDIDATES;
  }

  const isPetrochemicals =
    !isPPE &&
    !isCoatings &&
    !isValves &&
    !isPumps &&
    (lower.includes("polymer resin") ||
      lower.includes("petrochemical") ||
      lower.includes("virgin polymer") ||
      lower.includes("melt flow index") ||
      lower.includes("گرانول") ||
      lower.includes("پلی اتیلن") ||
      lower.includes("پلی پروپیلن") ||
      (lower.includes("پلیمر") &&
        !lower.includes("لباس") &&
        !lower.includes("رنگ")) ||
      (lower.includes("پتروشیمی") &&
        !lower.includes("لباس") &&
        !lower.includes("رنگ") &&
        !lower.includes("شیر") &&
        !lower.includes("پمپ")));

  if (isPetrochemicals) {
    return AUTHORITATIVE_PETROCHEMICAL_CANDIDATES;
  }

  if (text.length > 25) {
    return synthesizeDynamicCandidatesFromRequest(canonicalContext, text);
  }

  return AUTHORITATIVE_POULTRY_CANDIDATES;
}

function syntheticCandidate(
  index: number,
  pool: readonly CandidateProfile[],
): {
  candidate: CandidateV1;
  claim: ClaimV1;
  evidence: EvidenceItemV1;
} {
  const suffix = String(index).padStart(2, "0");
  const candidateId = `CAND-FIX-${suffix}`;
  const claimId = `CLM-FIX-${suffix}`;
  const evidenceId = `EVD-FIX-${suffix}`;
  const profile = pool[index - 1]!;
  const extract = profile.extract;
  const score = profile.score;
  const evidenceUrl = `https://supplier-${suffix}.example.invalid/evidence`;
  return {
    candidate: {
      candidateId,
      displayName: profile.displayName,
      countryCode: profile.countryCode,
      rationaleShort: profile.rationaleShort,
      rationaleClaimIds: [claimId],
      compatibilityScore: score,
      fitBand: score >= 88 ? "strong" : score >= 75 ? "moderate" : "low",
      bandCeiling: score >= 88 ? "strong" : score >= 75 ? "moderate" : "low",
      displayedBand: score >= 88 ? "strong" : score >= 75 ? "moderate" : "low",
      dimensionScores: {
        category_product_fit: score,
        compliance_certification_fit: Math.max(65, score - 5),
        volume_capacity_fit: Math.max(65, score - 3),
        price_tier_fit: Math.max(60, score - 8),
        positioning_brand_fit: Math.max(60, score - 6),
        geographic_reach_fit: Math.max(60, score - 4),
      },
      citations: [evidenceId],
      verificationStatus: "synthetic",
      mandatoryConstraintsSatisfied: true,
      failedConstraintIds: [],
      deterministicRankKey: `${String(100 - score).padStart(3, "0")}:${candidateId}`,
    },
    claim: {
      claimId,
      candidateId,
      text: profile.claimText,
      decisionBearing: true,
      verificationStatus: "synthetic",
      evidenceConfidence: score >= 90 ? "high" : score >= 80 ? "medium" : "low",
      evidenceIds: [evidenceId],
    },
    evidence: {
      evidenceId,
      sourceKind: "synthetic_fixture",
      url: evidenceUrl,
      title: profile.evidenceTitle,
      publisher: profile.publisher,
      publisherDomain: "example.invalid",
      retrievedAt: "2026-08-14T00:00:00.000Z",
      contentSha256: contentSha256(extract),
      extract,
      verificationDisposition: "accepted",
      exclusionReason: "",
    },
  };
}

export function buildSyntheticEvidenceGraph(
  runId: string,
  fixtureCase: keyof typeof SYNTHETIC_CASE_COUNTS,
  canonicalContext?: unknown,
  userTier?: string,
): EvidenceGraphV1 {
  const rawPool = resolveCandidatePool(canonicalContext);

  // Upstream uniqueness guarantee: deduplicate by lowercase display name
  const seenNames = new Set<string>();
  const uniquePool: CandidateProfile[] = [];
  for (const item of rawPool) {
    const key = item.displayName.trim().toLowerCase();
    if (!seenNames.has(key)) {
      seenNames.add(key);
      uniquePool.push(item);
    }
  }

  // Truthful count: requested count capped by distinct available candidates (NEVER duplicate or pad!)
  const requestedCount =
    userTier === "consultant" ? 20 : SYNTHETIC_CASE_COUNTS[fixtureCase];
  const count = Math.min(requestedCount, uniquePool.length);

  executeMultiLoopResearch({
    userTier: userTier || "demo",
    canonicalContext,
    candidateCount: count,
  });

  const records = Array.from({ length: count }, (_, index) =>
    syntheticCandidate(index + 1, uniquePool),
  );
  const candidates = records.map((record) => record.candidate);

  // The gate is evaluated before sorting. A score can never restore an ineligible item.
  const eligibleCandidateIds = selectEligibleCandidateIds(candidates);

  const graph: EvidenceGraphV1 = {
    schemaVersion: "evidence-graph.v1",
    runId,
    candidates,
    claims: records.map((record) => record.claim),
    evidence: records.map((record) => record.evidence),
    eligibleCandidateIds,
    gateEvaluationCompletedAt: "2026-08-14T00:00:00.000Z",
  };
  validateEvidenceGraph(graph);
  return graph;
}

export class SyntheticFixtureResearchAdapter implements ResearchCapability {
  readonly capabilityId = "CAP-SEARCH" as const;

  async research(input: ResearchInput): Promise<EvidenceGraphV1> {
    return buildSyntheticEvidenceGraph(input.runId, input.fixtureCase);
  }
}
