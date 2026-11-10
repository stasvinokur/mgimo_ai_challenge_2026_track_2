const zero = BigInt(0);
const one = BigInt(1);
const ten = BigInt(10);

export class ExactScore {
  private readonly numerator: bigint;
  private readonly denominator: bigint;

  private constructor(numerator: bigint, denominator: bigint) {
    let a = numerator;
    let b = denominator;
    while (b !== zero) [a, b] = [b, a % b];
    this.numerator = numerator / a;
    this.denominator = denominator / a;
  }

  static from(value: number): ExactScore {
    // Treat the input's decimal representation as exact, including exponent notation.
    const [mantissa = "0", exponent = "0"] = value.toString().split("e");
    const [whole = "0", fraction = ""] = mantissa.split(".");
    const digits = BigInt(whole + fraction);
    const scale = fraction.length - Number(exponent);
    return scale >= 0
      ? new ExactScore(digits, ten ** BigInt(scale))
      : new ExactScore(digits * ten ** BigInt(-scale), one);
  }

  add(other: ExactScore): ExactScore {
    return new ExactScore(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  scale(numerator: number, denominator = 1): ExactScore {
    const top = ExactScore.from(numerator);
    const bottom = ExactScore.from(denominator);
    return new ExactScore(
      this.numerator * top.numerator * bottom.denominator,
      this.denominator * top.denominator * bottom.numerator,
    );
  }

  atLeast(target: number): boolean {
    const other = ExactScore.from(target);
    return (
      this.numerator * other.denominator >= other.numerator * this.denominator
    );
  }

  minimumIncrement(target: number, weight: number, maxScore: number): number {
    const goal = ExactScore.from(target);
    const difference =
      goal.numerator * this.denominator - this.numerator * goal.denominator;
    if (difference <= zero) return 0;
    const required = new ExactScore(
      difference,
      goal.denominator * this.denominator,
    ).scale(maxScore, weight);
    return Number(
      (required.numerator + required.denominator - one) / required.denominator,
    );
  }

  toNumber(): number {
    // Conversion is only for DTOs; decisions always use the exact fraction.
    // 340 decimal places include subnormal numbers down to Number.MIN_VALUE.
    const precision = 340;
    const digits = (
      (this.numerator * ten ** BigInt(precision)) /
      this.denominator
    )
      .toString()
      .padStart(precision + 1, "0");
    return Number(`${digits.slice(0, -precision)}.${digits.slice(-precision)}`);
  }
}
