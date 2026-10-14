double average(List<double> samples) {
  return samples.reduce((sum, value) => sum + value) / samples.length;
}

void main() {
  final samples = [0.2, 0.8, -0.4, 0.5, 1.0];
  double amplitude = 'high';
  print(average(samples));
  print(amplitude);
}
