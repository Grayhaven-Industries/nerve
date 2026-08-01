// Dogfood: a realistic mobile-robot platform harness.
// Battery → e-stop → power distribution; CAN trunk with splice taps feeding
// four motor drivers and an IMU; encoder bundles per motor; sensor, fan,
// LED, and bumper drops. Exercises splices, cables, twist groups, a
// 3-level branch tree, and composable per-drive helpers.
import {
  harness, connector, wire, branch, label, splice, cable,
  type ConnectorPart, type ConnectorInstance, type WireDef, type SpliceDef
} from "@grayhaven/nerve"
import { AmassXT60, JstPH, MolexMegaFit, MolexMicroFit } from "@grayhaven/nerve-connectors"

// --- Parts: the verified library is the source of truth (PRD §30/§42) ---------
const xt60 = AmassXT60["XT60PW-M"]
const xt60F = AmassXT60["XT60PW-F"]
const megaFit8 = MolexMegaFit["76829-0008"]
const microFit16 = MolexMicroFit["43025-1600"]
const jstPh4 = JstPH["PHR-4"]
const jstPh2 = JstPH["PHR-2"]

// --- Power chain ---------------------------------------------------------------
const battery = connector("BAT1", xt60F, { pins: { 1: "VBAT_RAW", 2: "GND_BAT" } })
const charger = connector("CHG1", xt60, { pins: { 1: "VBAT_RAW", 2: "GND_BAT" } })
const faston4: ConnectorPart = {
  mpn: "63824-1", manufacturer: "TE Connectivity", family: "FASTON 250",
  description: "FASTON 250 tab header, 4 positions", pinCount: 4,
  wireGaugeRange: { min: "22AWG", max: "10AWG" }
}
const estop = connector("ESTOP1", faston4, {
  pins: { 1: "VBAT_RAW", 2: "VBAT_SW", 3: "ESTOP_SENSE", 4: "GND_SIG" }
})
const pdbIn = connector("PDB_IN", xt60, { pins: { 1: "VBAT_SW", 2: "GND_BAT" } })
const pdbOut = connector("PDB_OUT", megaFit8, {
  pins: {
    1: "VBAT_MD1", 2: "GND_MD1", 3: "VBAT_MD2", 4: "GND_MD2",
    5: "VBAT_MD3", 6: "GND_MD3", 7: "VBAT_MD4", 8: "GND_MD4"
  },
  terminals: "76650-0117"
})
const pdbAux = connector("PDB_AUX", MolexMicroFit["43025-0800"], {
  pins: {
    1: "5V_MCU", 2: "GND_MCU", 3: "12V_LIDAR", 4: "GND_LIDAR",
    5: "12V_FAN", 6: "GND_FAN", 7: "5V_SENS", 8: "GND_SENS"
  },
  terminals: "43030-0007"
})

const batPlus = splice("S_BP", {
  type: "crimp", part: "GT-2.5", branch: "spine", location: 80,
  notes: "Battery positive tap: pack, e-stop feed, charge port."
})
const batMinus = splice("S_BN", {
  type: "crimp", part: "GT-2.5", branch: "spine", location: 95,
  notes: "Battery negative tap: pack, PDB return, charge port."
})

// --- Controller + CAN trunk -----------------------------------------------------
const mcu = connector("MCU1", microFit16, {
  pins: {
    1: "5V_MCU", 2: "GND_MCU", 3: "CAN_H", 4: "CAN_L",
    5: "GPS_TX", 6: "GPS_RX", 7: "ESTOP_SENSE", 8: "LED_CTRL",
    9: "ETH_P", 10: "ETH_N", 11: "BUMP_L", 12: "BUMP_R",
    13: "GND_SIG", 14: "GND_SIG"
  },
  terminals: {
    1: "43030-0007", 2: "43030-0007", 3: "43030-0007", 4: "43030-0007",
    5: "43030-0010", 6: "43030-0010", 7: "43030-0007", 8: "43030-0010",
    9: "43030-0010", 10: "43030-0010", 11: "43030-0010", 12: "43030-0010",
    13: "43030-0010", 14: "43030-0010"
  },
  // 500 kbit/s sets the stub budget every CAN drop is measured against
  // (HK-ELEC-021). No `terminationOhms` anywhere on this harness is
  // deliberate and correct: the two 120Ω terminators live in the end
  // nodes, off-harness, so HK-ELEC-018 reports their absence for
  // information rather than as a defect.
  electrical: {
    3: { bitRateKbps: 500 },
    4: { bitRateKbps: 500 }
  }
})
const imu = connector("IMU1", jstPh4, {
  pins: { 1: "5V_SENS", 2: "GND_SENS", 3: "CAN_H", 4: "CAN_L" },
  terminals: "SPH-004T-P0.5S"
})

const canH = splice("S_CANH", {
  type: "solder-sleeve", part: "D-406-0001", branch: "ctrl", location: 120,
  notes: "CAN_H trunk tap. Maintain twist to within 25 mm of the splice."
})
const canL = splice("S_CANL", {
  type: "solder-sleeve", part: "D-406-0001", branch: "ctrl", location: 130,
  notes: "CAN_L trunk tap. Maintain twist to within 25 mm of the splice."
})

const canDrop = (
  tag: string, target: ConnectorInstance, length: number
): ReadonlyArray<WireDef> => [
  wire(`W_CANH_${tag}`, canH, target.pin(3), {
    gauge: "24AWG", color: "white", length, signal: "CAN_H", twistGroup: `TW_CAN_${tag}`
  }),
  wire(`W_CANL_${tag}`, canL, target.pin(4), {
    gauge: "24AWG", color: "blue", length, signal: "CAN_L", twistGroup: `TW_CAN_${tag}`
  })
]

// --- Drive modules (×4) — composable helper (PRD §9.10) -------------------------
interface Drive {
  readonly driver: ConnectorInstance
  readonly motor: ConnectorInstance
  readonly wires: ReadonlyArray<WireDef>
}

const drive = (n: 1 | 2 | 3 | 4, feedLength: number, encLength: number): Drive => {
  const driver = connector(`MD${n}`, MolexMicroFit["43025-0800"], {
    pins: {
      1: `VBAT_MD${n}`, 2: `GND_MD${n}`, 3: "CAN_H", 4: "CAN_L",
      5: `ENC${n}_A`, 6: `ENC${n}_B`, 7: `MOTOR${n}_TEMP`, 8: `SHIELD${n}_DRAIN`
    },
    terminals: {
      1: "43030-0007", 2: "43030-0007", 3: "43030-0007", 4: "43030-0007",
      5: "43030-0010", 6: "43030-0010", 7: "43030-0010", 8: "43030-0010"
    }
  })
  const motor = connector(`M${n}`, jstPh4, {
    pins: { 1: `ENC${n}_A`, 2: `ENC${n}_B`, 3: `MOTOR${n}_TEMP`, 4: `SHIELD${n}_DRAIN` },
    terminals: "SPH-004T-P0.5S"
  })
  const feedPin = (n - 1) * 2 + 1
  return {
    driver,
    motor,
    wires: [
      // 20AWG: Micro-Fit 3.0 max (verified); drives are sized accordingly.
      wire(`W_VBAT_MD${n}`, pdbOut.pin(feedPin), driver.pin(1), {
        gauge: "20AWG", color: "red", length: feedLength, signal: `VBAT_MD${n}`, currentEstimate: 3
      }),
      wire(`W_GND_MD${n}`, pdbOut.pin(feedPin + 1), driver.pin(2), {
        gauge: "20AWG", color: "black", length: feedLength, signal: `GND_MD${n}`, currentEstimate: 3
      }),
      ...canDrop(`MD${n}`, driver, feedLength + 60),
      wire(`W_ENCA_M${n}`, motor.pin(1), driver.pin(5), {
        gauge: "26AWG", color: "yellow", length: encLength, signal: `ENC${n}_A`
      }),
      wire(`W_ENCB_M${n}`, motor.pin(2), driver.pin(6), {
        gauge: "26AWG", color: "green", length: encLength, signal: `ENC${n}_B`
      }),
      wire(`W_TEMP_M${n}`, motor.pin(3), driver.pin(7), {
        gauge: "26AWG", color: "orange", length: encLength, signal: `MOTOR${n}_TEMP`
      }),
      wire(`W_SHLD_M${n}`, motor.pin(4), driver.pin(8), {
        gauge: "26AWG", color: "gray", length: encLength, signal: `SHIELD${n}_DRAIN`
      })
    ]
  }
}

const drives = [drive(1, 450, 120), drive(2, 470, 120), drive(3, 450, 120), drive(4, 470, 120)]

// --- Sensor / accessory drops -----------------------------------------------------
const gps = connector("GPS1", jstPh4, {
  pins: { 1: "5V_SENS", 2: "GND_SENS", 3: "GPS_TX", 4: "GPS_RX" },
  terminals: "SPH-004T-P0.5S"
})
const lidar = connector("LIDAR1", jstPh4, {
  pins: { 1: "12V_LIDAR", 2: "GND_LIDAR", 3: "ETH_P", 4: "ETH_N" },
  terminals: "SPH-004T-P0.5S"
})
const fan = connector("FAN1", jstPh2, {
  pins: { 1: "12V_FAN", 2: "GND_FAN" }, terminals: "SPH-004T-P0.5S"
})
const led = connector("LED1", jstPh2, {
  pins: { 1: "LED_CTRL", 2: "GND_SIG" }, terminals: "SPH-004T-P0.5S"
})
const bumpL = connector("BUMP1", jstPh2, {
  pins: { 1: "BUMP_L", 2: "GND_SIG" }, terminals: "SPH-004T-P0.5S"
})
const bumpR = connector("BUMP2", jstPh2, {
  pins: { 1: "BUMP_R", 2: "GND_SIG" }, terminals: "SPH-004T-P0.5S"
})

const ethCable = cable("C_ETH", {
  type: "2x26AWG twisted shielded", conductors: 2, shield: "braid",
  jacket: "PUR", outerDiameter: 3.8
})

export default harness("robot-platform-harness", {
  revision: "A",
  units: "mm",
  metadata: { project: "GH-R1 mobile platform", owner: "electrical" },
  connectors: [
    battery, charger, estop, pdbIn, pdbOut, pdbAux, mcu, imu,
    gps, lidar, fan, led, bumpL, bumpR,
    ...drives.flatMap((d) => [d.driver, d.motor])
  ],
  splices: [batPlus, batMinus, canH, canL],
  cables: [ethCable],
  wires: [
    // Battery → e-stop → PDB, with charge-port taps.
    wire("W_BAT_P", battery.pin(1), batPlus, { gauge: "12AWG", color: "red", length: 80, signal: "VBAT_RAW" }),
    wire("W_ESTOP_IN", batPlus, estop.pin(1), { gauge: "12AWG", color: "red", length: 140, signal: "VBAT_RAW" }),
    wire("W_ESTOP_OUT", estop.pin(2), pdbIn.pin(1), { gauge: "12AWG", color: "red", length: 130, signal: "VBAT_SW" }),
    wire("W_BAT_N", battery.pin(2), batMinus, { gauge: "12AWG", color: "black", length: 95, signal: "GND_BAT" }),
    wire("W_PDB_N", batMinus, pdbIn.pin(2), { gauge: "12AWG", color: "black", length: 260, signal: "GND_BAT" }),
    wire("W_CHG_P", charger.pin(1), batPlus, { gauge: "14AWG", color: "red", length: 160, signal: "VBAT_RAW" }),
    wire("W_CHG_N", charger.pin(2), batMinus, { gauge: "14AWG", color: "black", length: 165, signal: "GND_BAT" }),

    // MCU power + CAN trunk head.
    wire("W_5V_MCU", pdbAux.pin(1), mcu.pin(1), { gauge: "20AWG", color: "red", length: 300, signal: "5V_MCU" }),
    wire("W_GND_MCU", pdbAux.pin(2), mcu.pin(2), { gauge: "20AWG", color: "black", length: 300, signal: "GND_MCU" }),
    wire("W_CANH_MCU", mcu.pin(3), canH, { gauge: "24AWG", color: "white", length: 120, signal: "CAN_H", twistGroup: "TW_CAN_MCU" }),
    wire("W_CANL_MCU", mcu.pin(4), canL, { gauge: "24AWG", color: "blue", length: 130, signal: "CAN_L", twistGroup: "TW_CAN_MCU" }),
    ...canDrop("IMU", imu, 180),

    // Drive feeds, CAN drops, encoder bundles (×4).
    ...drives.flatMap((d) => d.wires),

    // Sensor power.
    wire("W_5V_SENS_GPS", pdbAux.pin(7), gps.pin(1), { gauge: "24AWG", color: "red", length: 380, signal: "5V_SENS" }),
    wire("W_GND_SENS_GPS", pdbAux.pin(8), gps.pin(2), { gauge: "24AWG", color: "black", length: 380, signal: "GND_SENS" }),
    wire("W_5V_SENS_IMU", pdbAux.pin(7), imu.pin(1), { gauge: "24AWG", color: "red", length: 340, signal: "5V_SENS" }),
    wire("W_GND_SENS_IMU", pdbAux.pin(8), imu.pin(2), { gauge: "24AWG", color: "black", length: 340, signal: "GND_SENS" }),

    // GPS UART.
    wire("W_GPS_TX", mcu.pin(5), gps.pin(3), { gauge: "26AWG", color: "yellow", length: 360, signal: "GPS_TX" }),
    wire("W_GPS_RX", mcu.pin(6), gps.pin(4), { gauge: "26AWG", color: "green", length: 360, signal: "GPS_RX" }),

    // Lidar power + Ethernet pair in shielded cable.
    wire("W_12V_LIDAR", pdbAux.pin(3), lidar.pin(1), { gauge: "24AWG", color: "red", length: 420, signal: "12V_LIDAR" }),
    wire("W_GND_LIDAR", pdbAux.pin(4), lidar.pin(2), { gauge: "24AWG", color: "black", length: 420, signal: "GND_LIDAR" }),
    wire("W_ETH_P", mcu.pin(9), lidar.pin(3), { gauge: "26AWG", color: "white", length: 400, signal: "ETH_P", twistGroup: "TW_ETH", cable: "C_ETH", conductor: 1 }),
    wire("W_ETH_N", mcu.pin(10), lidar.pin(4), { gauge: "26AWG", color: "blue", length: 400, signal: "ETH_N", twistGroup: "TW_ETH", cable: "C_ETH", conductor: 2 }),

    // Fan, LED, e-stop sense, bumpers.
    wire("W_12V_FAN", pdbAux.pin(5), fan.pin(1), { gauge: "24AWG", color: "red", length: 250, signal: "12V_FAN" }),
    wire("W_GND_FAN", pdbAux.pin(6), fan.pin(2), { gauge: "24AWG", color: "black", length: 250, signal: "GND_FAN" }),
    wire("W_LED_CTRL", mcu.pin(8), led.pin(1), { gauge: "26AWG", color: "violet", length: 280, signal: "LED_CTRL" }),
    wire("W_LED_RTN", led.pin(2), mcu.pin(13), { gauge: "26AWG", color: "black", length: 280, signal: "GND_SIG" }),
    wire("W_ESTOP_SENSE", mcu.pin(7), estop.pin(3), { gauge: "22AWG", color: "brown", length: 320, signal: "ESTOP_SENSE" }),
    wire("W_ESTOP_RTN", estop.pin(4), mcu.pin(14), { gauge: "22AWG", color: "black", length: 320, signal: "GND_SIG" }),
    wire("W_BUMP_L", mcu.pin(11), bumpL.pin(1), { gauge: "26AWG", color: "brown", length: 520, signal: "BUMP_L" }),
    wire("W_BUMP_L_RTN", bumpL.pin(2), mcu.pin(13), { gauge: "26AWG", color: "black", length: 520, signal: "GND_SIG" }),
    wire("W_BUMP_R", mcu.pin(12), bumpR.pin(1), { gauge: "26AWG", color: "brown", length: 520, signal: "BUMP_R" }),
    wire("W_BUMP_R_RTN", bumpR.pin(2), mcu.pin(14), { gauge: "26AWG", color: "black", length: 520, signal: "GND_SIG" })
  ],
  branches: [
    branch("spine", { path: [battery, estop, pdbIn], sleeve: "braided-pet-12", nominalLength: 350 }),
    branch("ctrl", { parent: "spine", breakoutDistance: 300, path: [mcu, imu], sleeve: "braided-pet-10", nominalLength: 400 }),
    branch("sens", { parent: "ctrl", breakoutDistance: 150, path: [gps, lidar], sleeve: "braided-pet-6", nominalLength: 300 }),
    branch("drive_l", { parent: "spine", breakoutDistance: 200, path: [pdbOut, drives[0]!.driver, drives[1]!.driver], sleeve: "braided-pet-10", nominalLength: 450 }),
    branch("drive_r", { parent: "spine", breakoutDistance: 200, path: [drives[2]!.driver, drives[3]!.driver], sleeve: "braided-pet-10", nominalLength: 450 }),
    branch("tail", { parent: "ctrl", breakoutDistance: 250, path: [fan, led, bumpL, bumpR], sleeve: "braided-pet-6", nominalLength: 200 })
  ],
  labels: [
    label("L1", { text: "GH-R1 SPINE", attachTo: "spine", offsetFrom: battery, distance: 50 }),
    label("L2", { text: "GH-R1 CTRL", attachTo: "ctrl", offsetFrom: mcu, distance: 40 }),
    label("L3", { text: "GH-R1 SENS", attachTo: "sens", offsetFrom: gps, distance: 30 }),
    label("L4", { text: "GH-R1 DRIVE L", attachTo: "drive_l", offsetFrom: pdbOut, distance: 40 }),
    label("L5", { text: "GH-R1 DRIVE R", attachTo: "drive_r", offsetFrom: drives[2]!.driver, distance: 40 }),
    label("L6", { text: "GH-R1 TAIL", attachTo: "tail", offsetFrom: fan, distance: 30 })
  ]
});
