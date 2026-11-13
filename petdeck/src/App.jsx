// 标准入口：BrowserRouter + App Shell（Phase C 集成完成）
import { BrowserRouter } from 'react-router-dom'
import { PetDeckApp } from './flows/petdeck/petdeck'

function App() {
  return (
    <BrowserRouter>
      <PetDeckApp />
    </BrowserRouter>
  )
}

export default App