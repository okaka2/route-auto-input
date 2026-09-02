import './styles.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  const heading = document.createElement('h1');
  heading.textContent = 'ルート自動入力';
  root.append(heading);
}
